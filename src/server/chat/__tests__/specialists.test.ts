import { describe, expect, it, vi } from "vitest";
import { KNOBS, KnobKey } from "@/domain/scene-knobs";
import { CATALOG } from "@/lib/recipes";
import { TOOLS } from "@/server/tools";

vi.mock("@/server/tool-calls", () => ({ callAndRecord: vi.fn() }));

const { chatTools, LEFT_OUT, TOOL_APPROVAL } = await import(
  "@/server/chat/chat-tools"
);
const { SPECIALISTS } = await import("@/server/chat/specialists");

const CTX = {
  tokenId: null,
  tokenName: "Chat",
  canSpend: true,
  sessionId: "s",
};
const names = new Set(TOOLS.map((t) => t.name));

describe("the specialists", () => {
  it("each offers only tools Kiln has, and the chat keeps", () => {
    for (const specialist of Object.values(SPECIALISTS)) {
      for (const tool of specialist.tools ?? []) {
        expect(names.has(tool), `${specialist.id}: ${tool}`).toBe(true);
        expect(LEFT_OUT.has(tool)).toBe(false);
      }
    }
  });

  it("a specialist's turn sees its own tools; only the general mode can suggest one", () => {
    const etsy = Object.keys(chatTools(CTX, SPECIALISTS.etsy));
    expect(etsy).toEqual(
      TOOLS.map((t) => t.name).filter((n) =>
        SPECIALISTS.etsy.tools?.includes(n),
      ),
    );
    expect(etsy).not.toContain("generate");
    expect(etsy).not.toContain("suggest_specialist");
    expect(Object.keys(chatTools(CTX, SPECIALISTS.scenes))).toContain(
      "tune_frame",
    );
    expect(Object.keys(chatTools(CTX, SPECIALISTS.kiln))).toContain(
      "suggest_specialist",
    );
  });

  it("know Kiln's own data: every knob and stop, and Etsy's text rules", () => {
    for (const knob of KnobKey.options) {
      expect(SPECIALISTS.scenes.instructions).toContain(KNOBS[knob].label);
    }
    expect(SPECIALISTS.scenes.instructions).toContain("overhead");
    const rules = CATALOG.destinations.find((d) => d.id === "etsy")?.text;
    expect(SPECIALISTS.etsy.instructions).toContain(
      `at most ${rules?.title.maxChars} characters`,
    );
    expect(SPECIALISTS.etsy.instructions).toContain(
      `${rules?.tags.count} of them`,
    );
  });

  it("SVG sees the design tools, draws only on a quote and the maker's click, and knows every trace setting", async () => {
    const svg = Object.keys(chatTools(CTX, SPECIALISTS.svg));
    expect(svg).toEqual([
      "list_designs",
      "get_design",
      "view_design",
      "vectorize",
      "quote",
      "draw",
    ]);
    expect(TOOL_APPROVAL.draw).toBe("user-approval");
    expect(TOOL_APPROVAL.vectorize).toBeUndefined();
    const { VectorDetail, VectorMode } = await import("@/server/vectorize");
    for (const option of [...VectorMode.options, ...VectorDetail.options]) {
      expect(SPECIALISTS.svg.instructions).toContain(`"${option}"`);
    }
  });

  it("a reply records any mode the chip offers", async () => {
    const { ChatMetadata } = await import("@/server/chat/messages");
    const { SpecialistId } = await import("@/server/chat/specialists");
    expect(ChatMetadata.shape.specialist.unwrap().options).toEqual(
      SpecialistId.options,
    );
  });

  it("edit_listing waits for the maker's click only to replace their text", () => {
    const rule = TOOL_APPROVAL.edit_listing as (input: unknown) => unknown;
    expect(rule({ title: "x" })).toBeUndefined();
    expect(rule({ title: "x", overwriteMakerText: true })).toBe(
      "user-approval",
    );
    expect(TOOL_APPROVAL.generate).toBe("user-approval");
  });
});
