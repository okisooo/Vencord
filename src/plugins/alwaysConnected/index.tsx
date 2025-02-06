/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

// Retrieve native functionality via VencordNative.
// Cast to unknown first, then to our nativeKeepAlive interface.
const Native = (VencordNative.pluginHelpers.AlwaysConnected as unknown) as {
    nativeKeepAlive: (channelId: string) => void;
};

const settings = definePluginSettings({
    autoRejoinDelay: {
        description: "Delay between reconnect attempts (in ms)",
        type: OptionType.NUMBER,
        default: 30000,
        restartNeeded: false,
    },
}) as any;

export default definePlugin({
    name: "AlwaysConnected",
    description:
        "Keeps you connected to voice channels and auto-rejoins if disconnected or on client refresh",
    authors: [Devs.okiso],
    settings,
    patches: [
        {
            // Target the voice reconnect prompt module
            find: '"jY2lUF"',
            replacement: {
                match: /(\i\."jY2lUF")/,
                replace: "$1&&(()=>{window.VoiceService?.reconnectToVoice()})(),"
            }
        }
    ],

    // Internal state
    monitorInterval: null as NodeJS.Timeout | null,
    lastVoiceChannel: null as string | null,
    dataStoreKey: "AlwaysConnected_lastVoiceChannel",
    wasManuallyDisconnected: false, // Add this

    flux: {
        // Listen for voice state updates
        VOICE_STATE_UPDATES({ updates }: { updates: any[]; }) {
            // If user manually disconnected (channelId is null), set the flag
            if (updates.some(u => u.channelId === null)) {
                this.wasManuallyDisconnected = true;
            }
        },

        // Reset manual disconnect flag when connection opens
        CONNECTION_OPEN() {
            this.wasManuallyDisconnected = false;
        }
    },

    async start() {
        console.log("[AlwaysConnected] Plugin started.");
        // Restore the last channel; undefined becomes null.
        this.lastVoiceChannel = (await DataStore.get<string>(this.dataStoreKey)) ?? null;
        // If a channel was saved and we’re not connected, try to reconnect.
        if (this.lastVoiceChannel && !this.isConnected()) {
            this.autoRejoin();
        }
        // Always try to invoke native keep-alive if we have a known channel.
        if (this.lastVoiceChannel) {
            Native.nativeKeepAlive(this.lastVoiceChannel);
        }
        // Monitor connection every few seconds.
        this.monitorInterval = setInterval(() => {
            if (!this.isConnected() && !this.wasManuallyDisconnected) {
                console.log("[AlwaysConnected] Disconnected; attempting rejoin.");
                this.autoRejoin();
                if (this.lastVoiceChannel) {
                    Native.nativeKeepAlive(this.lastVoiceChannel);
                }
            } else if (this.isConnected()) {
                // Reset the manual disconnect flag when we're connected
                this.wasManuallyDisconnected = false;
                const current = this.getCurrentVoiceChannelId();
                if (current) {
                    this.lastVoiceChannel = current;
                    DataStore.set(this.dataStoreKey, current);
                }
            }
        }, 3000);
    },

    stop() {
        console.log("[AlwaysConnected] Plugin stopped.");
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    },

    // Check whether the voice connection is active.
    isConnected() {
        try {
            const voiceConn = window.VoiceConnectionStore && window.VoiceConnectionStore.getConnection();
            return !!voiceConn;
        } catch {
            return false;
        }
    },

    // Retrieve the current voice channel id.
    getCurrentVoiceChannelId() {
        try {
            const channelId = window.SelectedChannelStore && window.SelectedChannelStore.getChannelId();
            return channelId ?? null;
        } catch {
            return null;
        }
    },

    // Auto-rejoin the voice channel using the client's API.
    autoRejoin() {
        const channelId = (this.lastVoiceChannel ?? null) || this.getCurrentVoiceChannelId();
        if (!channelId) return;
        const maxDelay = 60000; // Cap the delay at 60 seconds.
        const baseDelay = settings.autoRejoinDelay.default;
        const attemptRejoin = (attempt: number = 0) => {
            console.log(`[AlwaysConnected] Rejoining voice channel (Attempt ${attempt + 1}):`, channelId);
            try {
                if (window.VoiceService && typeof window.VoiceService.join === "function") {
                    window.VoiceService.join(channelId);
                }
            } catch (err) {
                console.error("[AlwaysConnected] Auto-rejoin error on attempt", attempt + 1, ":", err);
            }
            // If we're still disconnected, schedule another attempt.
            setTimeout(() => {
                if (!this.isConnected()) {
                    const delay = Math.min(baseDelay * (attempt + 1), maxDelay);
                    console.log(`[AlwaysConnected] Still disconnected. Retrying in ${delay}ms...`);
                    attemptRejoin(attempt + 1);
                } else {
                    console.log("[AlwaysConnected] Successfully reconnected to voice channel:", channelId);
                }
            }, Math.min(baseDelay * (attempt + 1), maxDelay));
        };
        attemptRejoin();
    },
});
