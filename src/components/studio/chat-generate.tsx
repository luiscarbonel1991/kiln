"use client";

import { ArrowRight, Check, ImageIcon } from "lucide-react";
import { useRef, useState } from "react";
import { generateImage } from "@/app/actions/generate";
import { PROMPT_PRESETS } from "@/components/studio/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isRenderableUrl } from "@/lib/asset-url";
import { gradientForPrompt } from "@/lib/gradient";
import { masterAssetFromGeneration } from "@/lib/master-asset";
import type { GenerationResult } from "@/providers/types";
import { useWorkspace } from "@/store/workspace";

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "image"; prompt: string; result: GenerationResult };

export function ChatGenerate() {
  const setMaster = useWorkspace((s) => s.setMaster);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous in-flight guard: the `pending` state is stale within the same
  // tick, so two rapid triggers (e.g. a fast double-click on a preset) would both
  // pass an `if (pending)` check and fire two generations. A ref blocks instantly.
  const inFlight = useRef(false);

  const lastImage = [...messages]
    .reverse()
    .find(
      (m): m is Extract<ChatMessage, { role: "image" }> => m.role === "image",
    );

  async function send(preset?: string) {
    const text = (preset ?? input).trim();
    if (!text || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text },
    ]);
    setPending(true);
    try {
      const result = await generateImage(text);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "image", prompt: text, result },
      ]);
    } catch {
      setError("Could not generate an image. Try again.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function useAsMaster() {
    if (!lastImage) return;
    setMaster(masterAssetFromGeneration(lastImage.result, lastImage.prompt));
  }

  return (
    <div className="flex h-[330px] flex-col overflow-hidden rounded-card bg-card shadow-card">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pt-4 pb-1">
        {messages.length === 0 && !pending ? (
          <div className="m-auto flex flex-col items-center gap-3 text-center text-on-surface-dim">
            <ImageIcon className="size-6 opacity-60" />
            <p className="text-[0.8125rem]">
              Describe the base image to create
            </p>
            <div className="flex max-w-[300px] flex-wrap justify-center gap-2">
              {PROMPT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => send(preset)}
                  className="rounded-pill border border-border-soft bg-secondary px-3 py-1 font-sans text-xs text-on-surface-mid transition-colors hover:border-primary"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              className="max-w-[80%] self-end rounded-[14px_14px_4px_14px] bg-secondary px-3 py-2 text-[0.8125rem] text-foreground"
            >
              {m.text}
            </div>
          ) : isRenderableUrl(m.result.assets[0]?.url) ? (
            <div key={m.id} className="w-[150px] self-start">
              {/* biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio */}
              <img
                src={m.result.assets[0]?.url}
                alt={m.prompt}
                className="h-[110px] w-full rounded-render object-cover shadow-render"
              />
            </div>
          ) : (
            <div key={m.id} className="w-[150px] self-start">
              <div
                className="h-[110px] rounded-render shadow-render"
                style={{ backgroundImage: gradientForPrompt(m.prompt) }}
              />
            </div>
          ),
        )}

        {pending ? (
          <p className="animate-pulse self-start font-mono text-xs text-on-surface-dim">
            generating image…
          </p>
        ) : null}
      </div>

      {lastImage && !pending ? (
        <Button
          className="mx-4 mb-2.5 bg-prov-recipe text-primary-foreground hover:bg-prov-recipe/90"
          onClick={useAsMaster}
        >
          <Check /> Use this as master asset
        </Button>
      ) : null}

      <div className="flex gap-2 border-t border-border-soft px-3 py-2.5">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder={
            messages.length ? "Refine the image…" : "Describe the image…"
          }
          className="bg-secondary"
        />
        <Button
          size="icon"
          onClick={() => send()}
          disabled={pending}
          aria-label="Send prompt"
        >
          <ArrowRight />
        </Button>
      </div>
      {error ? (
        <p className="px-4 pb-2 font-sans text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
