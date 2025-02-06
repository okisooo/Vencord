/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/DataStore";
import { Devs } from "@utils/constants";
import { definePlugin } from "@utils/types";
import { ContextMenu } from "@webpack/common"; // DiscordReact is Discord’s React
import React, { useEffect, useState } from "react";
// You may need to adjust the ContextMenu import based on your codebase

// /////////////////////////////////////////////
// Data Handling
// /////////////////////////////////////////////
export interface PinnedMessage {
  id: string;
  channelId: string;
  content: string;
  author: string;
  timestamp: number;
}

const PINNED_KEY = "ClientPinnedMessages";

function loadPinnedMessages(): PinnedMessage[] {
  return DataStore.get(PINNED_KEY, []) as PinnedMessage[];
}

function savePinnedMessages(pins: PinnedMessage[]): void {
  DataStore.set(PINNED_KEY, pins);
}

let pinnedMessages: PinnedMessage[] = loadPinnedMessages();

function isPinned(messageId: string): boolean {
  return pinnedMessages.some(pin => pin.id === messageId);
}

function togglePin(message: any) {
  // message is expected to have id, channel_id, content and author.username
  if (isPinned(message.id)) {
    pinnedMessages = pinnedMessages.filter(pin => pin.id !== message.id);
    alert("Message removed from your pins.");
  } else {
    pinnedMessages.push({
      id: message.id,
      channelId: message.channel_id,
      content: message.content,
      author: message.author.username,
      timestamp: Date.now()
    });
    alert("Message pinned for you.");
  }
  savePinnedMessages(pinnedMessages);
}

// /////////////////////////////////////////////
// Pinned Messages UI Component
// /////////////////////////////////////////////
const ClientPinsTab: React.FC = () => {
  const [pins, setPins] = useState<PinnedMessage[]>(loadPinnedMessages());

  // Poll for changes every couple seconds (a simple reactivity approach)
  useEffect(() => {
    const interval = setInterval(() => {
      setPins(loadPinnedMessages().slice().sort((a, b) => b.timestamp - a.timestamp));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: 10, overflowY: "auto", maxHeight: "100%" }}>
      <h2 style={{ marginTop: 0 }}>Your Pinned Messages</h2>
      {pins.length === 0 && <p>You haven’t pinned any messages yet.</p>}
      {pins.map(pin => (
        <div
          key={pin.id}
          style={{
            border: "1px solid #ccc",
            borderRadius: 4,
            padding: "8px",
            marginBottom: "8px",
            backgroundColor: "#2f3136"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontWeight: "bold" }}>{pin.author}</span>
            <span style={{ fontSize: "0.8em", color: "#888" }}>
              {new Date(pin.timestamp).toLocaleString()}
            </span>
          </div>
          <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{pin.content}</div>
          <button
            style={{
              marginTop: 4,
              backgroundColor: "#7289da",
              border: "none",
              padding: "4px 8px",
              borderRadius: 3,
              color: "#fff",
              cursor: "pointer"
            }}
            onClick={() => {
              pinnedMessages = pinnedMessages.filter(p => p.id !== pin.id);
              savePinnedMessages(pinnedMessages);
              setPins(loadPinnedMessages());
            }}
          >
            Unpin
          </button>
        </div>
      ))}
    </div>
  );
};

// /////////////////////////////////////////////
// Context Menu Patch
// /////////////////////////////////////////////
function patchMessageContextMenu() {
  // This patch adds a "Pin for Me" option in the message context menu.
  // It assumes the context menu's props include a `message` object.
  return ContextMenu.patch("MessageContextMenu", (menu, props) => {
    if (!props || !props.message) return menu;
    // Create a new menu item for toggling the client pin
    const pinItem = {
      type: "button",
      label: isPinned(props.message.id) ? "Unpin for Me" : "Pin for Me",
      action: () => {
        togglePin(props.message);
      }
    };
    // Add a separator before our item
    menu.children.push({ type: "separator" });
    menu.children.push(pinItem);
    return menu;
  });
}

// /////////////////////////////////////////////
// Plugin Definition
// /////////////////////////////////////////////
export default definePlugin({
  name: "ClientPinnedMessages",
  description:
    "Adds a client-side pin feature so you can save messages just for yourself—even if you don't have permissions—in a UI that feels native to Discord.",
  authors: [Devs.okiso],
  onStart() {
    pinnedMessages = loadPinnedMessages();
    this._unpatchContext = patchMessageContextMenu();
  },
  onStop() {
    if (this._unpatchContext) this._unpatchContext();
  },
  // Inject our ClientPinsTab into the existing pinned messages panel
  render() {
    return <ClientPinsTab />;
  }
});
