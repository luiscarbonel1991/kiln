"use client";

import { ToggleGroup } from "radix-ui";
import type { HeroProposal, HeroSetting } from "@/domain/hero-setting";
import { cn } from "@/lib/utils";

const OPTIONS: [HeroSetting, string][] = [
  ["sweep", "Plain backdrop"],
  ["place", "In its place"],
];

// Why the plan proposes this setting, in the maker's words.
function why(
  proposal: HeroProposal,
  family: string,
  destination: string,
): string {
  if (proposal.source === "remembered") {
    return `Your last choice for ${family} on ${destination}.`;
  }
  if (proposal.source === "mounted") {
    return `It is mounted where it is used (${proposal.place}): page-1 heroes show it there.`;
  }
  return "A plain backdrop: Kiln's default for a marketplace hero.";
}

// The hero's setting on the New project plan: the proposal and why, and the
// maker's own pick, remembered for the family when the project starts.
export function HeroSettingPicker({
  value,
  proposal,
  family,
  destination,
  testId,
  onChange,
}: {
  value: HeroSetting;
  proposal: HeroProposal;
  family: string;
  destination: string;
  testId: string;
  onChange: (setting: HeroSetting) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <ToggleGroup.Root
        type="single"
        aria-label="The hero's setting"
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as HeroSetting);
        }}
        className="flex gap-1 self-start rounded-field bg-secondary p-1"
      >
        {OPTIONS.map(([setting, label]) => (
          <ToggleGroup.Item
            key={setting}
            value={setting}
            data-testid={`${testId}-${setting}`}
            className={cn(
              "h-7 rounded-[9px] px-2 font-sans text-[0.72rem] transition-colors",
              value === setting
                ? "bg-primary text-primary-foreground"
                : "text-on-surface-mid hover:bg-surface-soft",
            )}
          >
            {label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      <span className="font-sans text-[0.68rem] leading-snug text-on-surface-mid">
        {value === proposal.setting
          ? why(proposal, family, destination)
          : `Your pick: Kiln proposes it next time for ${family} on ${destination}.`}
      </span>
    </div>
  );
}
