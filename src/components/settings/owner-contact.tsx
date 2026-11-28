import { PersonMark } from "@/components/settings/person-mark";

// The studio's owner as someone who works with them sees them under
// Settings → Providers: the person to write to about a key. An owner with
// no name is shown by their email, once.
export function OwnerContact({
  owner,
}: {
  owner: { name: string; email: string };
}) {
  const name = owner.name || owner.email;
  const link = (
    <a
      href={`mailto:${owner.email}`}
      data-testid="providers-owner"
      aria-label={`Write to ${name}`}
      className="font-sans text-[0.78rem] text-on-surface-mid underline underline-offset-2 [overflow-wrap:anywhere] hover:text-foreground"
    >
      {owner.email}
    </a>
  );
  return (
    <div className="flex items-center gap-3">
      <PersonMark name={name} />
      <div className="flex min-w-0 flex-1 flex-col">
        {owner.name ? (
          <span className="font-sans text-[0.9rem] font-semibold text-foreground">
            {owner.name}
          </span>
        ) : null}
        {link}
      </div>
    </div>
  );
}
