/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { debounce } from "@shared/debounce";
import { Logger } from "@utils/Logger";

import { settings } from "./settings";

export const logger = new Logger("AudioPiP");

export interface TrackInfo {
    src: string;
    title: string;
    author: string;
    isVoiceMessage: boolean;
    channelId?: string;
    messageId?: string;
    fallbackDuration: number;
}

export interface PlayerState {
    track: TrackInfo | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
}

const listeners = new Set<() => void>();
let state: PlayerState = {
    track: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1
};

function setState(patch: Partial<PlayerState>) {
    state = { ...state, ...patch };
    listeners.forEach(l => l());
}

export const playerStore = {
    getState: () => state,
    subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    }
};

export const toElementVolume = (volume: number) => volume ** 3;
export const fromElementVolume = (volume: number) => Math.cbrt(volume);

const clampVolume = (volume: unknown) =>
    typeof volume === "number" && Number.isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 1;

const persistVolume = debounce((volume: number) => {
    settings.store.volume = volume;
}, 500);

let audio: HTMLAudioElement | null = null;
let volumeBeforeMute = 1;

export const isPipAudio = (el: EventTarget | null) => el != null && el === audio;

function getDuration(el: HTMLAudioElement) {
    return Number.isFinite(el.duration) && el.duration > 0
        ? el.duration
        : state.track?.fallbackDuration ?? 0;
}

export function initPlayer() {
    const el = audio = new Audio();
    el.preload = "auto";

    const volume = clampVolume(settings.store.volume);
    el.volume = toElementVolume(volume);
    setState({ volume });

    const on = (event: keyof HTMLMediaElementEventMap, handler: () => void) =>
        el.addEventListener(event, () => audio === el && handler());

    on("play", () => setState({ isPlaying: true }));
    on("pause", () => setState({ isPlaying: false }));
    on("timeupdate", () => setState({ currentTime: el.currentTime }));
    on("durationchange", () => setState({ duration: getDuration(el) }));
    on("volumechange", () => syncVolume(fromElementVolume(el.volume)));
    on("error", () => {
        logger.error("Failed to play", state.track?.src, el.error);
        setState({ isPlaying: false });
    });
}

export function destroyPlayer() {
    if (!audio) return;

    const el = audio;
    audio = null;
    el.pause();
    el.removeAttribute("src");
    el.load();

    settings.store.volume = state.volume;
    setState({ track: null, isPlaying: false, currentTime: 0, duration: 0 });
}

function play() {
    audio?.play().catch(err => {
        if (err?.name !== "AbortError") logger.error("Failed to play", state.track?.src, err);
    });
}

export function openTrack(track: TrackInfo, startTime: number) {
    if (!audio) return;

    audio.src = track.src;
    audio.currentTime = startTime;
    audio.volume = toElementVolume(state.volume);

    setState({
        track,
        currentTime: startTime,
        duration: track.fallbackDuration,
        isPlaying: true
    });
    play();
}

export function closeTrack() {
    if (!audio || !state.track) return;

    audio.pause();
    // setting src to "" makes it try to load the page and error
    audio.removeAttribute("src");
    audio.load();

    setState({ track: null, isPlaying: false, currentTime: 0, duration: 0 });
}

export function getPlaybackTime() {
    return audio?.currentTime ?? 0;
}

export function togglePlayback() {
    if (!audio || !state.track) return;

    if (!audio.paused) {
        audio.pause();
        return;
    }

    if (audio.ended) {
        audio.currentTime = 0;
        setState({ currentTime: 0 });
    }
    play();
}

export function seek(time: number) {
    if (!audio || !Number.isFinite(time)) return;

    audio.currentTime = time;
    setState({ currentTime: time });
}

export function syncVolume(volume: number) {
    volume = clampVolume(volume);
    if (Math.abs(volume - state.volume) < 0.005) return;

    setState({ volume });
    persistVolume(volume);
}

export function setVolume(volume: number) {
    volume = clampVolume(volume);
    if (audio) audio.volume = toElementVolume(volume);
    syncVolume(volume);
}

export function toggleMute() {
    if (state.volume > 0) {
        volumeBeforeMute = state.volume;
        setVolume(0);
    } else {
        setVolume(volumeBeforeMute || 1);
    }
}
