/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const Corners = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type Corner = typeof Corners[number];

export const settings = definePluginSettings({
    alwaysShow: {
        type: OptionType.BOOLEAN,
        description: "Open the player as soon as audio starts playing, instead of only when you leave the channel",
        default: false
    }
}).withPrivateSettings<{
    volume?: number;
    scale?: number;
    corner?: Corner;
}>();
