/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Message, MessageAttachment } from "@vencord/discord-types";
import { MessageFlags } from "@vencord/discord-types/enums";
import { MessageStore, SelectedChannelStore } from "@webpack/common";

import type { TrackInfo } from "./player";

type Attachment = MessageAttachment & { duration_secs?: number; };

interface AttachmentMatch {
    message: Message;
    attachment: Attachment;
}

function parseUrl(src: string) {
    try {
        return new URL(src);
    } catch {
        return null;
    }
}

export function getMediaKey(src: string) {
    return parseUrl(src)?.pathname ?? src;
}

export function isAttachmentAudio(src: string) {
    const url = parseUrl(src);
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return false;

    const [, kind] = url.pathname.split("/");
    return kind === "attachments" || kind === "ephemeral-attachments";
}

function findAttachment(channelId: string, mediaKey: string) {
    let match: AttachmentMatch | undefined;

    MessageStore.getMessages(channelId)?.some(message => {
        const attachments = [
            ...(message.attachments ?? []),
            ...(message.messageSnapshots?.flatMap(s => s.message.attachments ?? []) ?? [])
        ] as Attachment[];

        const attachment = attachments.find(a =>
            getMediaKey(a.url) === mediaKey || getMediaKey(a.proxy_url) === mediaKey
        );

        if (attachment) match = { message, attachment };
        return attachment != null;
    });

    return match;
}

function decodeFilename(name: string | undefined) {
    if (!name) return null;
    try {
        return decodeURIComponent(name);
    } catch {
        return name;
    }
}

export function resolveTrack(src: string): TrackInfo {
    const mediaKey = getMediaKey(src);
    // /attachments/:channelId/:attachmentId/:filename
    const [, kind, urlChannelId, , urlFilename] = mediaKey.split("/");

    const channelIds = new Set<string>();
    if (kind === "attachments" && urlChannelId) channelIds.add(urlChannelId);
    // forwards point at the original channel
    const selectedChannelId = SelectedChannelStore.getChannelId();
    if (selectedChannelId) channelIds.add(selectedChannelId);

    for (const channelId of channelIds) {
        const match = findAttachment(channelId, mediaKey);
        if (!match) continue;

        const { message, attachment } = match;
        const isVoiceMessage = message.hasFlag?.(MessageFlags.IS_VOICE_MESSAGE) ?? false;

        return {
            src,
            title: isVoiceMessage ? "Voice Message" : attachment.filename || "Audio File",
            author: message.author?.username ?? "",
            isVoiceMessage,
            channelId: message.channel_id,
            messageId: message.id,
            fallbackDuration: attachment.duration_secs ?? 0
        };
    }

    const filename = decodeFilename(urlFilename);
    const isVoiceMessage = filename === "voice-message.ogg";

    return {
        src,
        title: isVoiceMessage ? "Voice Message" : filename || "Audio File",
        author: "",
        isVoiceMessage,
        fallbackDuration: 0
    };
}
