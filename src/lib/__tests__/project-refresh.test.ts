import { describe, expect, it } from "vitest";
import type { Card } from "@/domain/card";
import { cardsWithOwnPrompt, refreshCards } from "@/lib/project-refresh";

const field = (value: string, source: "image" | "recipe" | "local") => ({
  value,
  source,
  locked: source === "image",
});

const card = (id: string, value: string, extra: Partial<Card> = {}): Card => ({
  id,
  parentId: null,
  masterAssetId: "old-master",
  recipeId: "r",
  type: "image",
  direction: id,
  fields: {
    subject: field(`${value} subject`, "image"),
    materials: field(`${value} materials`, "image"),
    scene: field(`${value} scene`, "recipe"),
    composition: field("centered", "recipe"),
    lighting: field("soft", "recipe"),
    mood: field("calm", "recipe"),
    palette: field("#fff", "image"),
  },
  references: [],
  model: {
    provider: "openai",
    model: "gpt-image-2",
    aspect: "1:1",
    guidance: 7.5,
    strength: 0.65,
  },
  outputs: [],
  status: "draft",
  ...extra,
});

describe("refreshCards", () => {
  it("takes the product's fields, keeps the maker's own and everything made", () => {
    const mine = card("etsy.hero", "old", {
      outputs: ["https://stub.local/hero.png"],
      status: "done",
      promptOverride: "my prompt",
    });
    mine.fields.mood = field("moody blue", "local");
    const [refreshed] = refreshCards(
      [mine],
      [
        card("etsy.hero", "new", {
          references: ["https://stub.local/oak.jpg"],
        }),
      ],
      "m-2",
    );
    // The material sample comes with the product.
    expect(refreshed.references).toEqual(["https://stub.local/oak.jpg"]);
    expect(refreshed.fields.subject.value).toBe("new subject");
    expect(refreshed.fields.scene.value).toBe("new scene");
    expect(refreshed.fields.mood).toEqual(field("moody blue", "local"));
    expect(refreshed).toMatchObject({
      outputs: ["https://stub.local/hero.png"],
      status: "done",
      promptOverride: "my prompt",
      masterAssetId: "m-2",
    });
  });

  it("leaves a card the product no longer derives as it was, re-pointed", () => {
    const [kept] = refreshCards([card("etsy.gift", "old")], [], "m-2");
    expect(kept.fields.subject.value).toBe("old subject");
    expect(kept.masterAssetId).toBe("m-2");
  });

  it("names the cards that run their own prompt", () => {
    expect(
      cardsWithOwnPrompt([
        card("a", "x", { promptOverride: "mine" }),
        card("b", "x", { promptOverride: "  " }),
        card("c", "x"),
      ]),
    ).toEqual(["a"]);
  });
});
