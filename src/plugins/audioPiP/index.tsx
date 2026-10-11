/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { createRoot, SelectedChannelStore } from "@webpack/common";
import type { Root } from "react-dom/client";

import { getMediaKey, isAttachmentAudio, resolveTrack } from "./media";
import { PiPWindow } from "./PiPWindow";
import { closeTrack, destroyPlayer, fromElementVolume, getPlaybackTime, initPlayer, isPipAudio, openTrack, playerStore, syncVolume, toElementVolume, TrackInfo } from "./player";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";

interface LocalAudio {
    track: TrackInfo;
    channelId: string | undefined;
    lastTime: number;
}

let localAudios = new WeakMap<HTMLAudioElement, LocalAudio>();
const playingLocals = new Set<HTMLAudioElement>();
let abortController: AbortController | null = null;

function handOff(el: HTMLAudioElement) {
    const local = localAudios.get(el);
    if (!local || playerStore.getState().track) return;

    const time = el.currentTime || local.lastTime;
    if (!el.paused) el.pause();
    openTrack(local.track, time);
}

function trackLocalAudio(el: HTMLAudioElement, signal: AbortSignal) {
    const opts = { signal };

    el.addEventListener("timeupdate", () => {
        const local = localAudios.get(el);
        if (local && el.currentTime > 0) local.lastTime = el.currentTime;
    }, opts);

    el.addEventListener("volumechange", () => {
        if (!el.paused) syncVolume(fromElementVolume(el.volume));
    }, opts);

    el.addEventListener("ended", () => playingLocals.delete(el), opts);

    el.addEventListener("pause", () => {
        playingLocals.delete(el);

        // the browser pauses audio that gets removed from the page, i.e. the message was unmounted
        if (!el.ended && !el.isConnected) handOff(el);
    }, opts);
}

function onPlay(e: Event) {
    const el = e.target;
    if (!(el instanceof HTMLAudioElement) || isPipAudio(el) || !abortController) return;

    const src = el.currentSrc || el.src;
    if (!isAttachmentAudio(src)) return;

    let local = localAudios.get(el);
    if (!local) trackLocalAudio(el, abortController.signal);
    if (local?.track.src !== src) {
        local = { track: resolveTrack(src), channelId: undefined, lastTime: 0 };
        localAudios.set(el, local);
    }
    local.channelId = SelectedChannelStore.getChannelId();
    playingLocals.add(el);

    const { track, volume } = playerStore.getState();
    el.volume = toElementVolume(volume);

    if (track) {
        if (getMediaKey(track.src) === getMediaKey(src)) el.currentTime = getPlaybackTime();
        closeTrack();
    }

    if (settings.store.alwaysShow) handOff(el);
}

export default definePlugin({
    name: "AudioPiP",
    description: "Keeps audio files and voice messages playing in a floating player when you leave the channel",
    tags: ["Media", "Utility"],
    authors: [Devs.OKISO],
    settings,
    managedStyle,

    root: null as Root | null,
    container: null as HTMLDivElement | null,

    flux: {
        CHANNEL_SELECT({ channelId }: { channelId: string | null | undefined; }) {
            for (const el of playingLocals) {
                if (el.paused || localAudios.get(el)?.channelId === channelId) continue;

                handOff(el);
                return;
            }
        }
    },

    start() {
        initPlayer();

        abortController = new AbortController();
        document.addEventListener("play", onPlay, { capture: true, signal: abortController.signal });

        this.container = document.createElement("div");
        this.container.id = "vc-audio-pip-root";
        document.body.appendChild(this.container);

        this.root = createRoot(this.container);
        this.root.render(
            <ErrorBoundary noop>
                <PiPWindow />
            </ErrorBoundary>
        );
    },

    stop() {
        abortController?.abort();
        abortController = null;
        localAudios = new WeakMap();
        playingLocals.clear();

        this.root?.unmount();
        this.root = null;
        this.container?.remove();
        this.container = null;

        destroyPlayer();
    }
});
