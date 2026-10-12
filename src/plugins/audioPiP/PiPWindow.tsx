/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@api/Styles";
import { useForceUpdater } from "@utils/react";
import { MessageActions, React, useEffect, useRef, useState } from "@webpack/common";

import { closeTrack, playerStore, seek, setVolume, toggleMute, togglePlayback } from "./player";
import { Corner, Corners, settings } from "./settings";

export const cl = classNameFactory("vc-audio-pip-");

const BASE_WIDTH = 280;
const BASE_HEIGHT = 84;
const MIN_SCALE = 1;
const MAX_SCALE = 1.4;
const EDGE_GAP = 16;
const TOP_GAP = 72;
const DRAG_THRESHOLD = 4;
const RESIZE_SENSITIVITY = 150;

const icons = {
    voice: "M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
    audio: "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z",
    close: "M18.41 5.41L17 4L12 9L7 4L5.59 5.41L10.59 10.41L5.59 15.41L7 16.82L12 11.82L17 16.82L18.41 15.41L13.41 10.41L18.41 5.41Z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    replay: "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
    play: "M8 5v14l11-7z",
    mute: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.03c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z",
    volumeLow: "M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z",
    volumeHigh: "M3 9v6h4l5 5V4L9 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
};

function Icon({ path, size = 16, className }: { path: string; size?: number; className?: string; }) {
    return (
        <svg className={className} viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
            <path d={path} />
        </svg>
    );
}

interface Point {
    x: number;
    y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const clampScale = (scale: unknown) =>
    typeof scale === "number" && Number.isFinite(scale) ? clamp(scale, MIN_SCALE, MAX_SCALE) : MIN_SCALE;
const isCorner = (corner: unknown): corner is Corner => Corners.includes(corner as Corner);

function clampPosition({ x, y }: Point, width: number, height: number): Point {
    const maxX = window.innerWidth - width - EDGE_GAP;
    const maxY = window.innerHeight - height - EDGE_GAP;
    return {
        x: Math.max(EDGE_GAP, Math.min(x, maxX)),
        y: Math.max(TOP_GAP, Math.min(y, maxY))
    };
}

function getCornerPosition(corner: Corner, width: number, height: number): Point {
    const x = corner.endsWith("left") ? EDGE_GAP : window.innerWidth - width - EDGE_GAP;
    const y = corner.startsWith("top") ? TOP_GAP : window.innerHeight - height - EDGE_GAP;
    return clampPosition({ x, y }, width, height);
}

function getClosestCorner(point: Point, width: number, height: number) {
    let closest: Corner = "bottom-right";
    let closestDistance = Infinity;

    for (const corner of Corners) {
        const { x, y } = getCornerPosition(corner, width, height);
        const distance = Math.hypot(x - point.x, y - point.y);
        if (distance < closestDistance) {
            closest = corner;
            closestDistance = distance;
        }
    }

    return closest;
}

function formatTime(time: number) {
    if (!Number.isFinite(time) || time < 0) time = 0;

    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = String(Math.floor(time % 60)).padStart(2, "0");

    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
        : `${minutes}:${seconds}`;
}

interface Gesture {
    kind: "drag" | "resize";
    pointerId: number;
    startX: number;
    startY: number;
    origin: Point;
    startScale: number;
    active: boolean;
}

export function PiPWindow() {
    const { track, isPlaying, currentTime, duration, volume } = React.useSyncExternalStore(playerStore.subscribe, playerStore.getState);

    const [corner, setCorner] = useState<Corner>(() => isCorner(settings.store.corner) ? settings.store.corner : "bottom-right");
    const [scale, setScale] = useState(() => clampScale(settings.store.scale));
    const [dragPosition, setDragPosition] = useState<Point | null>(null);
    const [isSnapping, setIsSnapping] = useState(false);
    const gesture = useRef<Gesture | null>(null);

    const onWindowResize = useForceUpdater();
    useEffect(() => {
        window.addEventListener("resize", onWindowResize);
        return () => window.removeEventListener("resize", onWindowResize);
    }, []);

    if (!track) return null;

    const width = BASE_WIDTH * scale;
    const height = BASE_HEIGHT * scale;
    const position = dragPosition ?? getCornerPosition(corner, width, height);

    const isDragging = dragPosition != null;
    const hasEnded = !isPlaying && duration > 0 && currentTime >= duration - 0.25;
    const canJump = track.channelId != null && track.messageId != null;

    function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        // a pending gesture whose pointerup happened outside the window would otherwise block all future gestures
        if (e.button !== 0 || gesture.current?.active) return;

        const target = e.target as HTMLElement;
        const isResize = target.classList.contains(cl("resizer"));
        if (!isResize && target.closest("button, input")) return;

        gesture.current = {
            kind: isResize ? "resize" : "drag",
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            origin: position,
            startScale: scale,
            active: isResize
        };

        if (isResize) {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
        }
    }

    function applyGesture(g: Gesture, e: React.PointerEvent) {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;

        if (g.kind === "drag") {
            const next = clampPosition({ x: g.origin.x + dx, y: g.origin.y + dy }, width, height);
            setDragPosition(next);
            return next;
        }

        const sx = corner.endsWith("right") ? -1 : 1;
        const sy = corner.startsWith("bottom") ? -1 : 1;
        const next = clampScale(g.startScale + (sx * dx + sy * dy) / 2 / RESIZE_SENSITIVITY);
        setScale(next);
        return next;
    }

    function activateGesture(g: Gesture, e: React.PointerEvent<HTMLDivElement>) {
        g.active = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsSnapping(false);
        applyGesture(g, e);
    }

    function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId) return;

        if (g.active) applyGesture(g, e);
        else if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) >= DRAG_THRESHOLD) activateGesture(g, e);
    }

    function onPointerLeave(e: React.PointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.active || g.pointerId !== e.pointerId) return;

        // a quick flick can leave the window before any pointermove reaches it
        if (e.buttons & 1) activateGesture(g, e);
        else gesture.current = null;
    }

    function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId) return;
        gesture.current = null;

        if (!g.active) return;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);

        const result = applyGesture(g, e);
        if (typeof result === "number") {
            settings.store.scale = result;
            return;
        }

        const nextCorner = getClosestCorner(result, width, height);
        setIsSnapping(true);
        setDragPosition(null);
        setCorner(nextCorner);
        settings.store.corner = nextCorner;
    }

    function jumpToMessage() {
        if (!canJump) return;
        MessageActions.jumpToMessage({
            channelId: track!.channelId,
            messageId: track!.messageId,
            flash: true,
            jumpType: "INSTANT"
        });
    }

    return (
        <div
            className={cl("window", { dragging: isDragging, snapping: isSnapping })}
            style={{
                transform: `translate(${position.x}px, ${position.y}px)`,
                width,
                height
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onTransitionEnd={e => e.target === e.currentTarget && setIsSnapping(false)}
        >
            <div className={cl("container")} style={{ transform: `scale(${scale})` }}>
                <div className={cl("header")}>
                    <div className={cl("file-info")}>
                        <Icon className={cl("icon")} path={track.isVoiceMessage ? icons.voice : icons.audio} />
                        <div className={cl("meta")}>
                            <span
                                className={cl("title", { link: canJump })}
                                title={canJump ? `${track.title} (click to jump to message)` : track.title}
                                onClick={jumpToMessage}
                            >
                                {track.title}
                            </span>
                            {track.author && (
                                <span className={cl("author")} title={`@${track.author}`}>
                                    by @{track.author}
                                </span>
                            )}
                        </div>
                    </div>
                    <button className={cl("close")} onClick={closeTrack} aria-label="Close player">
                        <Icon path={icons.close} />
                    </button>
                </div>

                <div className={cl("controls")}>
                    <button
                        className={cl("play")}
                        onClick={togglePlayback}
                        aria-label={isPlaying ? "Pause" : hasEnded ? "Replay" : "Play"}
                    >
                        <Icon size={14} path={isPlaying ? icons.pause : hasEnded ? icons.replay : icons.play} />
                    </button>

                    <span className={cl("time")}>
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    <input
                        type="range"
                        className={cl("seek")}
                        aria-label="Seek"
                        min={0}
                        max={duration || 1}
                        step="any"
                        value={Math.min(currentTime, duration || 1)}
                        disabled={!duration}
                        onChange={e => seek(e.currentTarget.valueAsNumber)}
                        style={{ "--vc-audio-pip-progress": `${duration ? Math.min(currentTime / duration, 1) * 100 : 0}%` } as React.CSSProperties}
                    />

                    <div className={cl("volume")} onMouseLeave={e => e.currentTarget.querySelector("input")?.blur()}>
                        <button className={cl("volume-button")} onClick={toggleMute} aria-label={volume === 0 ? "Unmute" : "Mute"}>
                            <Icon size={14} path={volume === 0 ? icons.mute : volume < 0.5 ? icons.volumeLow : icons.volumeHigh} />
                        </button>
                        <input
                            type="range"
                            className={cl("volume-slider")}
                            aria-label="Volume"
                            min={0}
                            max={1}
                            step={0.01}
                            value={volume}
                            onChange={e => setVolume(e.currentTarget.valueAsNumber)}
                            onPointerUp={e => e.currentTarget.blur()}
                            style={{ "--vc-audio-pip-progress": `${volume * 100}%` } as React.CSSProperties}
                        />
                    </div>
                </div>
            </div>
            <div className={cl("resizer", `resizer-${corner}`)} />
        </div>
    );
}
