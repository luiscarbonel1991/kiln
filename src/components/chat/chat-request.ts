import type { UIMessage } from "ai";

// What the browser sends for a turn: the maker's new message, or only their
// yes or no to the last reply's waiting calls. The server takes nothing
// else of a reply (mergeIncoming), and a reply in the browser still holds
// the takes the agent looked at, too large to send back.
export function sentMessage<M extends UIMessage>(message: M): M {
  if (message.role !== "assistant") return message;
  const answers = message.parts.flatMap((part) => {
    const tool = part as {
      type: string;
      toolCallId?: string;
      state?: string;
      approval?: unknown;
    };
    const isTool =
      tool.type.startsWith("tool-") || tool.type === "dynamic-tool";
    return isTool && tool.state === "approval-responded"
      ? [
          {
            type: tool.type,
            toolCallId: tool.toolCallId,
            state: tool.state,
            approval: tool.approval,
          },
        ]
      : [];
  });
  return { ...message, parts: answers } as unknown as M;
}
