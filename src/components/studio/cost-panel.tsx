"use client";

import {
  AlertTriangle,
  Calculator,
  ChevronDown,
  RotateCcw,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { analyzeSvgGeometryAction } from "@/app/actions/analyze-geometry";
import { estimatePrice } from "@/lib/pricing/estimate";
import {
  DEFAULT_JOB,
  DEFAULT_SHOP,
  MACHINE_PRESETS,
  MATERIAL_PRESETS,
} from "@/lib/pricing/presets";
import type { Operation, ShopProfile, SvgGeometry } from "@/lib/pricing/types";
import { cn } from "@/lib/utils";
import {
  getMakerProfile,
  saveMakerProfile,
} from "@/server/maker-profile-repository";

const OPS: Operation[] = ["cut", "score", "engrave"];
// Outline-only SVGs (no closed subpaths) estimate a 0 fill, which would price an
// engrave pass as free; fall back to a typical fill so "engrave" always costs time.
const FALLBACK_FILL_FRACTION = 0.2;
const MIN_FILL_FRACTION = 0.01;
const money = (n: number) => `$${n.toFixed(2)}`;
const dur = (s: number) =>
  s >= 60 ? `${(s / 60).toFixed(1)} min` : `${s.toFixed(0)}s`;

// "Cost & price" — derives a laser job's cost from the vectorized .svg geometry and
// the maker's shop presets. Geometry is fetched once (server action); the price then
// recomputes client-side (estimatePrice is pure) as inputs change. App-only (moat).
export function CostPanel({ vectorUrl }: { vectorUrl: string }) {
  const [open, setOpen] = useState(false);
  const [geometry, setGeometry] = useState<SvgGeometry | null>(null);
  const [load, setLoad] = useState<"idle" | "loading" | "error">("idle");

  const [machineIdx, setMachineIdx] = useState(0);
  const [materialIdx, setMaterialIdx] = useState(1);
  const [sizeMm, setSizeMm] = useState(DEFAULT_JOB.longestSideMm);
  const [qty, setQty] = useState(DEFAULT_JOB.quantity);
  const [finishingMin, setFinishingMin] = useState(DEFAULT_JOB.finishingMin);
  const [fillFraction, setFillFraction] = useState(FALLBACK_FILL_FRACTION);
  const [assignment, setAssignment] = useState<Record<string, Operation>>({});

  // The maker's calibrated rates (labor, markup, waste…). Starts from the presets
  // and is overwritten by the saved profile on first open, so a maker calibrates
  // once and it sticks across sessions.
  const [shop, setShop] = useState<ShopProfile>(DEFAULT_SHOP);
  const [shopOpen, setShopOpen] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  async function fetchGeometry() {
    setLoad("loading");
    try {
      const g = await analyzeSvgGeometryAction({ vectorUrl });
      setGeometry(g);
      setAssignment(
        Object.fromEntries(g.layers.map((l) => [l.color, "cut" as Operation])),
      );
      setFillFraction(
        g.fillFractionEstimate >= MIN_FILL_FRACTION
          ? g.fillFractionEstimate
          : FALLBACK_FILL_FRACTION,
      );
      setLoad("idle");
    } catch {
      setLoad("error");
    }
  }

  async function loadProfile() {
    try {
      const p = await getMakerProfile();
      if (p) {
        const mi = MACHINE_PRESETS.findIndex((m) => m.name === p.machineName);
        const xi = MATERIAL_PRESETS.findIndex((m) => m.name === p.materialName);
        if (mi >= 0) setMachineIdx(mi);
        if (xi >= 0) setMaterialIdx(xi);
        setShop(p.shop);
      }
    } catch {
      // keep presets/defaults on any failure
    } finally {
      setProfileLoaded(true);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !geometry && load !== "loading") void fetchGeometry();
    if (next && !profileLoaded) void loadProfile();
  }

  const machine = MACHINE_PRESETS[machineIdx];
  const material = MATERIAL_PRESETS[materialIdx];
  const anyEngrave = Object.values(assignment).some((op) => op === "engrave");
  const patchShop = (patch: Partial<ShopProfile>) =>
    setShop((s) => ({ ...s, ...patch }));

  async function saveDefaults() {
    setSaveState("saving");
    try {
      await saveMakerProfile({
        machineName: machine.name,
        materialName: material.name,
        shop,
      });
      setSaveState("saved");
    } catch {
      setSaveState("idle");
    }
  }

  // Revert the "Saved" badge to "Save" as soon as any persisted input changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the persisted inputs should reset the badge
  useEffect(() => {
    setSaveState("idle");
  }, [machineIdx, materialIdx, shop]);

  const price = useMemo(() => {
    if (!geometry) return null;
    return estimatePrice(geometry, machine, material, shop, {
      longestSideMm: Math.max(1, sizeMm),
      quantity: Math.max(1, Math.round(qty)),
      finishingMin: Math.max(0, finishingMin),
      fillFraction: Math.min(1, Math.max(0, fillFraction)),
      assignment,
    });
  }, [
    geometry,
    machine,
    material,
    shop,
    sizeMm,
    qty,
    finishingMin,
    fillFraction,
    assignment,
  ]);

  return (
    <div className="border-border-soft border-t">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-4 py-3 font-sans text-xs font-medium text-prov-recipe"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
        <Calculator className="size-3.5" /> Cost &amp; price
        {price ? (
          <span className="ml-auto font-mono text-[0.6875rem] text-foreground">
            {money(price.unitPrice)}
            <span className="text-on-surface-dim"> /unit</span>
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {load === "loading" ? (
            <p className="py-2 font-mono text-[0.6875rem] text-on-surface-dim">
              reading geometry from the .svg…
            </p>
          ) : null}
          {load === "error" ? (
            <div className="flex items-center justify-between gap-2 rounded-field bg-secondary px-3 py-2">
              <span className="font-sans text-[0.6875rem] text-prov-local">
                Could not read the .svg geometry.
              </span>
              <button
                type="button"
                onClick={() => void fetchGeometry()}
                className="flex items-center gap-1 font-sans text-[0.6875rem] font-semibold text-primary"
              >
                <RotateCcw className="size-2.5" /> Retry
              </button>
            </div>
          ) : null}

          {geometry && price ? (
            <>
              {/* Layers -> operation assignment (LightBurn-style, by color) */}
              <div className="flex flex-col gap-1.5">
                <Label>Layers ({geometry.layers.length})</Label>
                {geometry.layers.map((layer) => (
                  <div key={layer.color} className="flex items-center gap-2">
                    <span
                      className="size-3.5 flex-shrink-0 rounded-swatch ring-1 ring-border"
                      style={{ backgroundColor: layer.color }}
                    />
                    <span className="w-16 font-mono text-[0.625rem] text-on-surface-dim">
                      {((layer.lengthPx * price.scaleMmPerPx) / 10).toFixed(1)}{" "}
                      cm
                    </span>
                    <select
                      value={assignment[layer.color] ?? "cut"}
                      onChange={(e) =>
                        setAssignment((a) => ({
                          ...a,
                          [layer.color]: e.target.value as Operation,
                        }))
                      }
                      className="flex-1 rounded-field bg-secondary px-2 py-1 font-sans text-[0.6875rem] text-foreground outline-none focus:ring-1 focus:ring-ring"
                    >
                      {OPS.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Job inputs */}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Size (longest, mm)">
                  <NumberInput value={sizeMm} onChange={setSizeMm} min={1} />
                </Field>
                <Field label="Quantity">
                  <NumberInput value={qty} onChange={setQty} min={1} />
                </Field>
                <Field label="Material">
                  <Select
                    value={materialIdx}
                    onChange={setMaterialIdx}
                    options={MATERIAL_PRESETS.map((m, i) => [i, m.name])}
                  />
                </Field>
                <Field label="Machine">
                  <Select
                    value={machineIdx}
                    onChange={setMachineIdx}
                    options={MACHINE_PRESETS.map((m, i) => [i, m.name])}
                  />
                </Field>
                <Field label="Finishing (min)">
                  <NumberInput
                    value={finishingMin}
                    onChange={setFinishingMin}
                    min={0}
                  />
                </Field>
                {anyEngrave ? (
                  <Field label="Engrave fill (%)">
                    <NumberInput
                      value={Math.round(fillFraction * 100)}
                      onChange={(v) => setFillFraction(v / 100)}
                      min={0}
                      max={100}
                    />
                  </Field>
                ) : null}
              </div>

              {!price.fitsOnSheet ? (
                <p className="flex items-start gap-1.5 rounded-field bg-prov-local/10 px-3 py-2 font-sans text-[0.6875rem] text-prov-local">
                  <AlertTriangle className="mt-0.5 size-3 flex-shrink-0" />
                  <span>
                    Larger than the {material.name} sheet — billed across{" "}
                    {Math.ceil(price.sheetsPerUnit)} sheets. Reduce the size or
                    pick a bigger sheet.
                  </span>
                </p>
              ) : null}

              {/* Machine time by operation */}
              <div className="rounded-field bg-secondary/60 px-3 py-2 font-mono text-[0.625rem]">
                <Row
                  k={`cut · ${(price.operations.cut.lengthMm / 10).toFixed(1)}cm`}
                  v={dur(price.operations.cut.timeSec)}
                />
                <Row
                  k={`score · ${(price.operations.score.lengthMm / 10).toFixed(1)}cm`}
                  v={dur(price.operations.score.timeSec)}
                />
                <Row
                  k={`engrave · ${price.operations.engrave.areaMm2.toFixed(0)}mm²`}
                  v={dur(price.operations.engrave.timeSec)}
                />
                <Row k="machine time" v={dur(price.machineTimeSec)} strong />
              </div>

              {/* Cost buildup */}
              <div className="font-mono text-[0.625rem]">
                <Row
                  k={
                    price.fitsOnSheet
                      ? `material (${price.piecesPerSheet}/sheet)`
                      : `material (${Math.ceil(price.sheetsPerUnit)} sheets/unit)`
                  }
                  v={money(price.costs.material)}
                />
                <Row k="electricity" v={money(price.costs.electricity)} />
                <Row k="machine wear" v={money(price.costs.machineWear)} />
                <Row k="labor" v={money(price.costs.labor)} />
                <Row
                  k={`setup (÷${Math.max(1, Math.round(qty))})`}
                  v={money(price.costs.setup)}
                />
                <Row k="unit cost" v={money(price.unitCost)} strong />
              </div>

              {/* Suggested price */}
              <div className="flex items-end justify-between rounded-field bg-primary/[0.06] px-3 py-2.5">
                <div>
                  <div className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-on-surface-dim">
                    Suggested price
                  </div>
                  <div className="font-serif text-2xl font-semibold text-primary">
                    {money(price.unitPrice)}
                  </div>
                </div>
                <div className="text-right font-mono text-[0.625rem] text-on-surface-mid">
                  <div>×{shop.markup} markup</div>
                  <div>margin {money(price.margin)}</div>
                </div>
              </div>

              {/* Quantity tiers */}
              <div>
                <Label>Price per unit by quantity</Label>
                <div className="mt-1.5 flex justify-between gap-1">
                  {price.tiers.map((t) => (
                    <div
                      key={t.qty}
                      className="flex flex-1 flex-col items-center rounded-field bg-secondary py-1.5"
                    >
                      <span className="font-mono text-[0.5625rem] text-on-surface-dim">
                        {t.qty}×
                      </span>
                      <span className="font-mono text-[0.625rem] font-semibold text-foreground">
                        {money(t.unitPrice)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Editable shop rates + persist as this maker's defaults */}
              <div className="rounded-field border border-border-soft">
                <button
                  type="button"
                  onClick={() => setShopOpen((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-2.5 py-1.5 font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-on-surface-dim"
                >
                  <ChevronDown
                    className={cn(
                      "size-3 transition-transform",
                      shopOpen && "rotate-180",
                    )}
                  />
                  Shop rates &amp; margin
                </button>
                {shopOpen ? (
                  <div className="flex flex-col gap-2 px-2.5 pb-2.5">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Markup (×)">
                        <NumberInput
                          value={shop.markup}
                          onChange={(v) => patchShop({ markup: v })}
                          min={1}
                        />
                      </Field>
                      <Field label="Labor ($/hr)">
                        <NumberInput
                          value={shop.laborRatePerHr}
                          onChange={(v) => patchShop({ laborRatePerHr: v })}
                          min={0}
                        />
                      </Field>
                      <Field label="Electricity ($/kWh)">
                        <NumberInput
                          value={shop.electricityRateKwh}
                          onChange={(v) => patchShop({ electricityRateKwh: v })}
                          min={0}
                        />
                      </Field>
                      <Field label="Waste (%)">
                        <NumberInput
                          value={Math.round(shop.wastePct * 100)}
                          onChange={(v) => patchShop({ wastePct: v / 100 })}
                          min={0}
                        />
                      </Field>
                      <Field label="Setup ($)">
                        <NumberInput
                          value={shop.setupFee}
                          onChange={(v) => patchShop({ setupFee: v })}
                          min={0}
                        />
                      </Field>
                      <Field label="Minimum ($)">
                        <NumberInput
                          value={shop.minimumPrice}
                          onChange={(v) => patchShop({ minimumPrice: v })}
                          min={0}
                        />
                      </Field>
                      <Field label="Handling (min)">
                        <NumberInput
                          value={shop.handlingMin}
                          onChange={(v) => patchShop({ handlingMin: v })}
                          min={0}
                        />
                      </Field>
                    </div>
                    <button
                      type="button"
                      onClick={() => void saveDefaults()}
                      disabled={saveState !== "idle"}
                      className="flex items-center justify-center gap-1.5 rounded-field bg-primary px-3 py-1.5 font-sans text-[0.6875rem] font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
                    >
                      <Save className="size-3" />
                      {saveState === "saved"
                        ? "Saved as your defaults"
                        : saveState === "saving"
                          ? "Saving…"
                          : "Save as my defaults"}
                    </button>
                  </div>
                ) : null}
              </div>

              <p className="font-sans text-[0.5625rem] leading-snug text-on-surface-dim">
                Prices from your saved rates · machine speeds are presets —
                calibrate them for your exact machine.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-on-surface-dim">
      {children}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is rendered as children (a custom input/select) nested inside this label, which the rule can't see statically
    <label className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  // Clamp on change so the displayed value always equals the priced value — a
  // cleared field (Number("")===0) can't show 0 while the estimate uses the floor.
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        let n = Number(e.target.value);
        if (min !== undefined) n = Math.max(min, n);
        if (max !== undefined) n = Math.min(max, n);
        onChange(n);
      }}
      className="w-full rounded-field bg-secondary px-2 py-1 font-mono text-[0.6875rem] text-foreground outline-none focus:ring-1 focus:ring-ring"
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: number;
  onChange: (v: number) => void;
  options: [number, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded-field bg-secondary px-2 py-1 font-sans text-[0.6875rem] text-foreground outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map(([i, name]) => (
        <option key={i} value={i}>
          {name}
        </option>
      ))}
    </select>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex justify-between border-border-soft border-b py-1 last:border-b-0",
        strong && "font-semibold text-foreground",
      )}
    >
      <span className={cn(!strong && "text-on-surface-dim")}>{k}</span>
      <span className={cn(!strong && "text-on-surface-mid")}>{v}</span>
    </div>
  );
}
