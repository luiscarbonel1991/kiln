"use client";

import {
  CircleAlert,
  CircleCheck,
  Ellipsis,
  KeyRound,
  Loader2,
  Plus,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, useTransition } from "react";
import {
  checkProviderKeyAction,
  removeProviderKeyAction,
} from "@/app/actions/settings";
import { PersonMark } from "@/components/settings/person-mark";
import {
  AddKeyFormView,
  EditKeyFormView,
  type KeyChoice,
  ReplaceKeyFormView,
} from "@/components/settings/provider-key-form";
import { Button } from "@/components/ui/button";
import { MenuRoot, MenuTrigger } from "@/components/ui/menu";
import { firstName } from "@/lib/first-name";
import type { KeyAnswer } from "@/lib/provider-key-forms";
import {
  article,
  keyEnding,
  MOCK_CALLS_LINE,
  removeKeyLine,
} from "@/lib/provider-key-words";
import type {
  ProviderKeyCard,
  ProviderKeyView,
} from "@/server/provider-health";
import type { TeamMemberView } from "@/server/team";

// A key's row as the page hands it: its dates already in words, read on the
// server so the browser renders the same text.
export type KeyRow = ProviderKeyView & {
  lastOkWhen: string | null;
  errorWhen: string | null;
};

export type KeyCard = Omit<ProviderKeyCard, "keys"> & { keys: KeyRow[] };

type Open =
  | { form: "add" }
  | { form: "edit" | "replace"; keyId: string }
  | null;

const ITEM =
  "cursor-pointer rounded-[9px] px-2.5 py-1.5 font-sans text-sm text-foreground outline-none data-[disabled]:cursor-default data-[disabled]:text-on-surface-dim data-[highlighted]:bg-secondary";

// Where an answer shows ("card" is the card's foot), and the key whose
// remove confirmation is open, if any.
export interface Landing {
  at: string;
  confirming: string | null;
}

// A removal that worked says so at the card's foot, its row being gone; one
// that failed keeps its question open, with the answer on the row.
export const afterRemove = (keyId: string, answer: KeyAnswer): Landing =>
  answer.ok
    ? { at: "card", confirming: null }
    : { at: keyId, confirming: keyId };

// The line of an answer, under a key's row or at the card's foot:
// "Checking…" while that key's free check runs, then its answer, plain on a
// row whose own line already says what failed ("Saved." or "Checked." on a
// rejected key).
export function KeySaid({
  testId,
  checking,
  said,
  alarm,
}: {
  testId: string;
  checking: boolean;
  said: KeyAnswer | null;
  alarm: boolean;
}) {
  if (!checking && !said) return null;
  const plain = checking || said?.ok || alarm;
  return (
    <p
      className={`flex items-center gap-1.5 font-sans text-xs leading-snug [overflow-wrap:anywhere] ${
        plain ? "text-on-surface-mid" : "text-fail"
      }`}
      data-testid={testId}
      aria-live="polite"
    >
      {checking ? (
        <>
          <Loader2 className="size-3 flex-shrink-0 animate-spin" />
          Checking…
        </>
      ) : (
        said?.message
      )}
    </p>
  );
}

// Whether a person on a key is the one reading the page.
const isYou = (team: TeamMemberView[], memberId: string) =>
  team.some((m) => m.id === memberId && m.you);

// Whether a row carries a line on what is wrong with its key.
const hasAlarm = (row: KeyRow) =>
  row.line !== null || (row.lastError !== null && !row.keyRejected);

const choiceOf = (row: KeyRow): KeyChoice => ({
  id: row.id,
  name: row.name,
  forTeam: row.forTeam,
  people: row.people.map((p) => ({ memberId: p.memberId })),
});

// Who uses a key: the whole team, or each person's mark and name.
function Who({ row, team }: { row: KeyRow; team: TeamMemberView[] }) {
  if (row.forTeam) {
    return (
      <span className="font-sans text-[0.78rem] text-on-surface-mid">
        The whole team
      </span>
    );
  }
  if (row.people.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="flex gap-1">
        {row.people.map((p) => (
          <PersonMark key={p.memberId} name={p.name} small />
        ))}
      </span>
      <span className="font-sans text-[0.78rem] text-on-surface-mid">
        {row.people
          .map((p) => (isYou(team, p.memberId) ? "You" : p.name))
          .join(", ")}
      </span>
    </div>
  );
}

// Settings → Providers, the owner's: a provider's keys, who uses each, its
// own last calls, and what can be done with it (check, change, replace,
// remove), with the line on the owner's own calls above and "Add" under. The
// forms and the remove confirmation open in the card, as the team list's
// invite and "Remove" do. A mock run shows the rows and the mock line only,
// as a member's card does.
export function ProviderKeys({
  card,
  team,
  mock,
}: {
  card: KeyCard;
  team: TeamMemberView[];
  mock: boolean;
}) {
  const { provider, label } = card;
  const [open, setOpen] = useState<Open>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // The last answer, on the row it is about, or the card's ("card").
  const [said, setSaid] = useState<(KeyAnswer & { at: string }) | null>(null);
  // The key whose free check is running.
  const [checking, setChecking] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // An action from a row; `after` says where its answer goes and whether
  // the remove confirmation stays open.
  const run = (
    work: () => Promise<KeyAnswer>,
    after: (answer: KeyAnswer) => Landing,
  ) =>
    startTransition(async () => {
      const answer = await work();
      const next = after(answer);
      setChecking(null);
      setConfirming(next.confirming);
      setSaid({ at: next.at, ...answer });
    });

  const show = (next: Open) => {
    setSaid(null);
    setConfirming(null);
    setOpen(next);
  };

  // A new key's answer shows on its row, the others where they were asked.
  const saved = (at: string) => (answer: KeyAnswer) => {
    setOpen(null);
    setSaid({ at: answer.keyId ?? at, ...answer });
  };

  const forms = { provider, label, keys: card.keys.map(choiceOf), team };

  const removeLine = (row: KeyRow) => {
    const others = row.people
      .filter((p) => !isYou(team, p.memberId))
      .map((p) => firstName(p.name));
    // The owner reads themself as "You" alone, or last: "Bob and you".
    const people = row.people.some((p) => isYou(team, p.memberId))
      ? others.length === 0
        ? ["You"]
        : [...others, "you"]
      : others;
    return removeKeyLine({
      label,
      name: row.name,
      forTeam: row.forTeam,
      people,
      teamKey: card.keys.some((k) => k.forTeam && k.id !== row.id),
    });
  };

  // The last answer, shown where it belongs, or the check running there.
  const saidLine = (at: string, alarm = false) => (
    <KeySaid
      testId={
        at === "card" ? `provider-${provider}-said` : `provider-key-said-${at}`
      }
      checking={pending && checking === at}
      said={said?.at === at ? said : null}
      alarm={alarm}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-on-surface-mid"
        data-testid={`provider-${provider}-key`}
      >
        <KeyRound className="mt-0.5 size-3.5 flex-shrink-0" />
        {mock ? MOCK_CALLS_LINE : card.ownCalls}
      </div>
      {!mock && card.envNote ? (
        <p className="font-sans text-[0.78rem] leading-snug text-on-surface-mid [overflow-wrap:anywhere]">
          {card.envNote}
        </p>
      ) : null}

      {card.keys.length > 0 ? (
        <ul
          className="flex flex-col divide-y divide-border-soft"
          data-testid={`provider-${provider}-keys`}
        >
          {card.keys.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-1.5 py-3"
              data-testid={`provider-key-${row.id}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-sans text-[0.875rem] font-semibold text-foreground [overflow-wrap:anywhere]">
                    {row.name} ·{" "}
                    <span className="whitespace-nowrap">
                      {keyEnding(row.hint)}
                    </span>
                  </span>
                  <Who row={row} team={team} />
                </div>
                {mock ? null : (
                  <MenuRoot>
                    <MenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Manage ${row.name}`}
                        data-testid={`provider-key-manage-${row.id}`}
                        disabled={pending}
                        className="relative shrink-0 text-on-surface-mid after:absolute after:-inset-2"
                      >
                        <Ellipsis />
                      </Button>
                    </MenuTrigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        align="end"
                        sideOffset={4}
                        className="z-50 min-w-[12rem] rounded-field bg-card p-1 shadow-card ring-1 ring-border"
                      >
                        <DropdownMenu.Item
                          data-testid={`provider-key-check-${row.id}`}
                          aria-label={`Check ${row.name}`}
                          disabled={!row.readable}
                          className={ITEM}
                          onSelect={() => {
                            setSaid(null);
                            setChecking(row.id);
                            run(
                              () => checkProviderKeyAction({ keyId: row.id }),
                              () => ({ at: row.id, confirming: null }),
                            );
                          }}
                        >
                          Check the key
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-testid={`provider-key-edit-${row.id}`}
                          aria-label={`Change the name or people of ${row.name}`}
                          className={ITEM}
                          onSelect={() => show({ form: "edit", keyId: row.id })}
                        >
                          Change name or people
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          data-testid={`provider-key-replace-${row.id}`}
                          aria-label={`Replace ${row.name}`}
                          className={ITEM}
                          onSelect={() =>
                            show({ form: "replace", keyId: row.id })
                          }
                        >
                          Replace the key
                        </DropdownMenu.Item>
                        <DropdownMenu.Separator className="my-1 h-px bg-border" />
                        <DropdownMenu.Item
                          data-testid={`provider-key-remove-${row.id}`}
                          aria-label={`Remove ${row.name}`}
                          className={`${ITEM} text-fail`}
                          onSelect={() => {
                            show(null);
                            setConfirming(row.id);
                          }}
                        >
                          Remove
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </MenuRoot>
                )}
              </div>

              {/* A mock run calls nothing: no call to speak of, no alarm. */}
              {mock ? null : row.line ? (
                <div className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-foreground">
                  <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-fail" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {row.line}
                  </span>
                </div>
              ) : null}
              {/* A rejected key is said by the row's line, once. */}
              {!mock && row.lastError && !row.keyRejected ? (
                <div className="flex items-start gap-2 font-sans text-[0.8rem] leading-snug text-foreground">
                  <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-fail" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {row.lastError.message}{" "}
                    <span className="font-mono text-[0.65rem] text-on-surface-dim">
                      {row.errorWhen}
                    </span>
                  </span>
                </div>
              ) : null}
              {mock ? null : (
                <div className="flex items-center gap-2 font-sans text-[0.8rem] text-on-surface-mid">
                  <CircleCheck className="size-3.5 flex-shrink-0 text-prov-recipe" />
                  {row.lastOkWhen
                    ? `Last call that worked: ${row.lastOkWhen}`
                    : "No call that worked yet"}
                </div>
              )}
              {saidLine(row.id, hasAlarm(row))}

              {confirming === row.id ? (
                <div className="flex flex-col gap-2 rounded-render border border-border-soft bg-card p-3">
                  <p className="font-sans text-[0.78rem] leading-snug text-foreground">
                    {removeLine(row)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={pending}
                      data-testid={`provider-key-remove-confirm-${row.id}`}
                      onClick={() =>
                        run(
                          () => removeProviderKeyAction({ keyId: row.id }),
                          (answer) => afterRemove(row.id, answer),
                        )
                      }
                    >
                      Remove {row.name}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Keep ${row.name}`}
                      data-testid={`provider-key-remove-keep-${row.id}`}
                      onClick={() => setConfirming(null)}
                    >
                      Keep
                    </Button>
                  </div>
                </div>
              ) : null}

              {open?.form === "edit" && open.keyId === row.id ? (
                <EditKeyFormView
                  {...forms}
                  target={choiceOf(row)}
                  onSaved={saved(row.id)}
                  onCancel={() => setOpen(null)}
                />
              ) : null}
              {open?.form === "replace" && open.keyId === row.id ? (
                <ReplaceKeyFormView
                  provider={provider}
                  target={choiceOf(row)}
                  onSaved={saved(row.id)}
                  onCancel={() => setOpen(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {saidLine("card")}
      {mock ? null : open?.form === "add" ? (
        <AddKeyFormView
          {...forms}
          onSaved={saved("card")}
          onCancel={() => setOpen(null)}
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          data-testid={`provider-${provider}-add`}
          onClick={() => show({ form: "add" })}
        >
          <Plus />
          Add {article(label)} {label} key
        </Button>
      )}
    </div>
  );
}
