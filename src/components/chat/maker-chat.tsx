"use client";

import { ChatPanel } from "@/components/chat/chat-panel";
import type { ChatPanelData } from "@/server/chat/chat-view";

// The Chat page's conversation: a new one takes its place in the address
// once its first message makes it, without reloading the page.
export function MakerChat({
  data,
  title,
}: {
  data: ChatPanelData;
  title: string;
}) {
  return (
    <ChatPanel
      data={data}
      title={title}
      onSession={(id) =>
        window.history.replaceState(null, "", `/chat?session=${id}`)
      }
    />
  );
}
