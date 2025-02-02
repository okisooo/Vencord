/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { exec } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

let nativeMonitorInterval: NodeJS.Timeout | null = null;
const stateFile = join(__dirname, "alwaysConnectedState.json");

/**
 * Persist the last known channel id to disk.
 * @param channelId - The voice channel id.
 */
function saveChannelId(channelId: string) {
    try {
        writeFileSync(stateFile, JSON.stringify({ channelId }), "utf8");
    } catch (err) {
        console.error("[AlwaysConnected/native] Error saving channel id:", err);
    }
}

/**
 * Load the stored voice channel id from disk.
 * @returns The stored channel id or null.
 */
function loadChannelId(): string | null {
    try {
        const data = readFileSync(stateFile, "utf8");
        const parsed = JSON.parse(data);
        return parsed.channelId ?? null;
    } catch (err) {
        return null;
    }
}

/**
 * Checks if the Discord process is running.
 * On Windows, it runs "tasklist" and searches for "discord.exe".
 *
 * @param callback - Called with true if Discord is running, false otherwise.
 */
function isDiscordRunning(callback: (running: boolean) => void) {
    exec("tasklist", (error, stdout, stderr) => {
        if (error) {
            console.error("[AlwaysConnected/native] Error checking Discord process:", error);
            callback(false);
            return;
        }
        const running = stdout.toLowerCase().includes("discord.exe");
        callback(running);
    });
}

/**
 * Actually join/rejoin the voice channel using Discord's API.
 * @param channelId - The voice channel id to connect to.
 */
function rejoinChannel(channelId: string) {
    console.log("[AlwaysConnected/native] Attempting to connect to voice channel:", channelId);

    try {
        // Dispatch a voice state update to force a reconnection
        FluxDispatcher.dispatch({
            type: "VOICE_STATE_UPDATES",
            updates: [{
                channelId: channelId,
                guildId: null, // Will be populated by Discord
                selfMute: false,
                selfDeaf: false
            }]
        });
    } catch (err) {
        console.error("[AlwaysConnected/native] Error while joining vc:", err);
    }
}

/**
 * Starts a native monitor that runs every few seconds.
 * It verifies that Discord is running, loads the stored channel id,
 * and tries to rejoin the channel if necessary.
 *
 * @param channelId
 */
export function startNativeMonitor(channelId: string) {
    // Save the channel ID for persistence across crashes/reloads
    saveChannelId(channelId);

    if (nativeMonitorInterval) return; // Already monitoring

    console.log("[AlwaysConnected/native] Starting native monitor for channel:", channelId);

    nativeMonitorInterval = setInterval(() => {
        // Check if Discord is running and we have a stored channel
        const storedChannelId = loadChannelId();
        if (!storedChannelId) {
            console.warn("[AlwaysConnected/native] No stored channel id found.");
            return;
        }

        // If we're not connected to the voice channel, attempt to rejoin
        if (!VoiceConnectionStore?.getConnection()) {
            console.log("[AlwaysConnected/native] Not connected, attempting rejoin...");
            rejoinChannel(storedChannelId);
        }
    }, 5000); // Check every 5 seconds
}

/**
 * Stops the native monitor.
 */
export function stopNativeMonitor() {
    console.log("[AlwaysConnected/native] Stopping native monitor.");
    if (nativeMonitorInterval) {
        clearInterval(nativeMonitorInterval);
        nativeMonitorInterval = null;
    }
}

/**
 * The nativeKeepAlive function serves as the entry point for native logic.
 * It receives the current voice channel id, saves it, and ensures the native monitor is running.
 *
 * @param channelId - The voice channel id.
 */
export function nativeKeepAlive(channelId: string) {
    console.log("[AlwaysConnected/native] Received native keep-alive for channel:", channelId);
    saveChannelId(channelId);
    if (!nativeMonitorInterval) {
        startNativeMonitor(channelId);
    }
    // Additional immediate checks or reconnection logic can be added here if needed.
}
