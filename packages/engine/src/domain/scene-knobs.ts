import { z } from "zod";

// Scene knobs (ROADMAP "Knobs, not prose"): a maker who is not a designer
// tunes a scene by picking a stop, never by writing prose. Each stop carries a
// curated clause for one prompt field; "any" adds nothing and leaves it to the
// model. A slot offers the knobs it names, with its default stops.

export const KnobKey = z.enum([
  "camera",
  "distance",
  "light",
  "shadow",
  "props",
]);
export type KnobKey = z.infer<typeof KnobKey>;

export const CameraStop = z.enum(["any", "eye", "above", "overhead"]);
export const DistanceStop = z.enum(["any", "close", "medium", "wide"]);
export const LightStop = z.enum(["any", "window", "studio", "warm"]);
export const ShadowStop = z.enum(["any", "faint", "soft", "strong"]);
export const PropsStop = z.enum(["any", "none", "few", "styled"]);

const STOPS = {
  camera: CameraStop,
  distance: DistanceStop,
  light: LightStop,
  shadow: ShadowStop,
  props: PropsStop,
} as const;

export type KnobStop<K extends KnobKey> = z.infer<(typeof STOPS)[K]>;
export type KnobField = "scene" | "composition" | "lighting";

export interface Stop {
  label: string;
  // What the stop does, in the maker's words.
  hint: string;
  // How the board's summary line names it.
  short: string;
  // The clause the prompt reads ("" for "any").
  text: string;
}

const ANY: Stop = {
  label: "Any",
  hint: "Kiln adds nothing; the model decides",
  short: "",
  text: "",
};

export const KNOBS: {
  [K in KnobKey]: {
    label: string;
    field: KnobField;
    stops: Record<KnobStop<K>, Stop>;
  };
} = {
  camera: {
    label: "Camera",
    field: "composition",
    stops: {
      any: ANY,
      eye: {
        label: "Eye level",
        hint: "Straight on, as a person sees it",
        short: "eye level",
        text: "eye level or slightly above",
      },
      above: {
        label: "A little above",
        hint: "Looks down on it a little",
        short: "a little above",
        text: "the camera a little above, looking down at about 30 degrees, so the top of anything lying flat shows",
      },
      overhead: {
        label: "From above",
        hint: "Looks down steeply; the face reads less",
        short: "from above",
        text: "the camera high above, looking down at about 60 degrees",
      },
    },
  },
  distance: {
    label: "Distance",
    field: "composition",
    stops: {
      any: ANY,
      close: {
        label: "Close",
        hint: "The product fills the frame",
        short: "close",
        text: "framed close, filling most of the frame",
      },
      medium: {
        label: "Medium",
        hint: "The product with its place around it",
        short: "medium",
        text: "a medium shot, its surroundings readable",
      },
      wide: {
        label: "Wide",
        hint: "More of the place, the product smaller in it",
        short: "wide",
        text: "a wider shot with room around it",
      },
    },
  },
  light: {
    label: "Light",
    field: "lighting",
    stops: {
      any: ANY,
      window: {
        label: "Window",
        hint: "Soft daylight from one side",
        short: "window light",
        text: "natural window light",
      },
      studio: {
        label: "Studio",
        hint: "Bright and even",
        short: "studio light",
        text: "soft, even studio light",
      },
      warm: {
        label: "Warm",
        hint: "Golden, cosy light",
        short: "warm light",
        text: "warm natural light",
      },
    },
  },
  shadow: {
    label: "Shadow",
    field: "lighting",
    stops: {
      any: ANY,
      faint: {
        label: "Faint",
        hint: "Barely there, just under it",
        short: "faint shadow",
        text: "only a faint contact shadow",
      },
      soft: {
        label: "Soft",
        hint: "A gentle shadow that grounds it",
        short: "soft shadow",
        text: "a soft contact shadow",
      },
      strong: {
        label: "Strong",
        hint: "Crisp shadows, like direct sun",
        short: "strong shadow",
        text: "crisp, defined shadows, as in direct sun",
      },
    },
  },
  props: {
    label: "Props",
    field: "scene",
    stops: {
      any: ANY,
      none: {
        label: "None",
        hint: "Only the product and its place",
        short: "no props",
        text: "no props beyond the place itself",
      },
      few: {
        label: "A few",
        hint: "One or two things that belong there",
        short: "a few props",
        text: "one or two everyday objects that belong there, beside it and never in front of it",
      },
      styled: {
        label: "Styled",
        hint: "A styled setting, the props secondary",
        short: "styled props",
        text: "styled with a few chosen props, all secondary to the product",
      },
    },
  },
};

// A knob's stops in order, "any" first.
export function knobStops<K extends KnobKey>(knob: K): KnobStop<K>[] {
  return STOPS[knob].options as KnobStop<K>[];
}

// The stops a slot writes (its defaults, in the seed): a typo fails.
export const SceneKnobs = z
  .object({
    camera: CameraStop.optional(),
    distance: DistanceStop.optional(),
    light: LightStop.optional(),
    shadow: ShadowStop.optional(),
    props: PropsStop.optional(),
  })
  .strict();
export type SceneKnobs = z.infer<typeof SceneKnobs>;

// The stops a plan keeps: a stop a later version drops reads as unset, so a
// saved plan never stops parsing.
export const SavedKnobs = z.object({
  camera: CameraStop.optional().catch(undefined),
  distance: DistanceStop.optional().catch(undefined),
  light: LightStop.optional().catch(undefined),
  shadow: ShadowStop.optional().catch(undefined),
  props: PropsStop.optional().catch(undefined),
});

// One knob set by the maker; null returns it to the slot's default.
export const KnobChoice = z.discriminatedUnion("knob", [
  z.object({ knob: z.literal("camera"), stop: CameraStop.nullable() }),
  z.object({ knob: z.literal("distance"), stop: DistanceStop.nullable() }),
  z.object({ knob: z.literal("light"), stop: LightStop.nullable() }),
  z.object({ knob: z.literal("shadow"), stop: ShadowStop.nullable() }),
  z.object({ knob: z.literal("props"), stop: PropsStop.nullable() }),
]);
export type KnobChoice = z.infer<typeof KnobChoice>;

type StopMap = Partial<Record<KnobKey, string>>;

export interface EffectiveKnobs {
  // The knobs the slot offers, in knob order.
  offered: KnobKey[];
  // The stop each offered knob applies.
  stops: SceneKnobs;
  // The knobs the maker set.
  chosen: KnobKey[];
}

// The slot's defaults, with the maker's own choices over them. (A part lying
// flat once raised the camera on its own; on 10/20 "a little above" did not
// show more of a flat base than eye level, so the stop stays the maker's.)
export function effectiveKnobs(
  defaults: SceneKnobs,
  tuned: SceneKnobs = {},
): EffectiveKnobs {
  const offered = KnobKey.options.filter((k) => defaults[k] !== undefined);
  const chosen = offered.filter((k) => tuned[k] !== undefined);
  const stops: StopMap = Object.fromEntries(
    offered.map((k) => [k, tuned[k] ?? defaults[k]]),
  );
  return { offered, stops: stops as SceneKnobs, chosen };
}

function stopOf(knob: KnobKey, stops: SceneKnobs): Stop | null {
  const key = stops[knob];
  return key ? (KNOBS[knob].stops as Record<string, Stop>)[key] : null;
}

// The clause each knob adds ("any" adds none).
export function knobText(stops: SceneKnobs): StopMap {
  return Object.fromEntries(
    KnobKey.options.flatMap((k) => {
      const text = stopOf(k, stops)?.text;
      return text ? [[k, text]] : [];
    }),
  );
}

// The board's line: "A little above · medium · window light".
export function knobSummary(knobs: EffectiveKnobs): string {
  const line = knobs.offered
    .map((k) => stopOf(k, knobs.stops)?.short)
    .filter(Boolean)
    .join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

// What's off about a take, in the maker's words; each moves one knob. A step
// walks the knob's stops (not "any"); from "any" it goes to `fromAny`.
export const ReasonKey = z.enum(["top", "small", "busy", "dark", "harsh"]);
export type ReasonKey = z.infer<typeof ReasonKey>;

export const REASONS: Record<
  ReasonKey,
  { label: string; knob: KnobKey; step?: 1 | -1; to?: string; fromAny: string }
> = {
  top: {
    label: "Can't see its top",
    knob: "camera",
    step: 1,
    fromAny: "above",
  },
  small: {
    label: "Product too small",
    knob: "distance",
    step: -1,
    fromAny: "close",
  },
  busy: { label: "Too busy", knob: "props", step: -1, fromAny: "few" },
  dark: { label: "Too dark", knob: "light", to: "studio", fromAny: "studio" },
  harsh: {
    label: "Shadows too strong",
    knob: "shadow",
    step: -1,
    fromAny: "soft",
  },
};

// The knob a reason moves and where to, or null when the slot does not offer
// it or it cannot move further that way.
export function reasonMove(
  reason: ReasonKey,
  knobs: EffectiveKnobs,
): KnobChoice | null {
  const r = REASONS[reason];
  if (!knobs.offered.includes(r.knob)) return null;
  const current = knobs.stops[r.knob] ?? "any";
  const steps = knobStops(r.knob).slice(1) as string[];
  let next: string | undefined;
  if (r.to) next = r.to;
  else if (current === "any") next = r.fromAny;
  else next = steps[steps.indexOf(current) + (r.step ?? 0)];
  if (!next || next === current) return null;
  return KnobChoice.parse({ knob: r.knob, stop: next });
}
