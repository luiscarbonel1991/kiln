import { PersonMark } from "@/components/settings/person-mark";

// The studio's owner as someone who works with them sees them under
// Settings → Providers: the person to write to about a key.
export function OwnerContact({
  owner,
}: {
  owner: { name: string; email: string };
}) {
  return (
    <div className="flex items-center gap-3">
      <PersonMark name={owner.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-sans text-[0.9rem] font-semibold text-foreground">
          {owner.name}
        </span>
        <a
          href={`mailto:${owner.email}`}
          data-testid="providers-owner"
          aria-label={`Write to ${owner.name}`}
          className="font-sans text-[0.78rem] text-on-surface-mid underline underline-offset-2 [overflow-wrap:anywhere] hover:text-foreground"
        >
          {owner.email}
        </a>
      </div>
    </div>
  );
}
