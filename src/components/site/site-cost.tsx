import type { SiteKit } from "@/lib/site-kit";

const money = (n: number) => `$${n.toFixed(2)}`;

// What the page's own kit cost, line by line, as Kiln recorded it, and where
// the plans will go.
export function SiteCost({ kit }: { kit: SiteKit }) {
  const c = kit.cost;
  const rows: { item: string; cost: number; paid?: boolean }[] = [
    { item: `${kit.frames.length} frames drawn from the spec`, cost: 0 },
    { item: "The listing text, drafted from the spec", cost: 0 },
    {
      item: `${c.sceneTakes} scene takes on an image model`,
      cost: c.scenes,
      paid: true,
    },
    {
      item: `1 video, ${kit.video.seconds} seconds`,
      cost: c.video,
      paid: true,
    },
  ];
  return (
    <section id="cost" className="kl-band kl-cost" aria-labelledby="cost-title">
      <div className="kl-cost-copy">
        <h2 id="cost-title">Everything on this page cost {money(c.total)}.</h2>
        <p>
          What Kiln draws from your spec is free. Only image, video and text
          models cost money, and that total counts every take: the two that
          failed their check, and four made before we changed the name on the
          coaster.
        </p>
        <ul className="kl-rules">
          <li>Each paid step shows its price before it runs.</li>
          <li>A monthly cap stops the spending.</li>
          <li>A call that never answered is not tried again.</li>
          <li>Nothing is sent or published without your click.</li>
        </ul>
      </div>
      <div className="kl-receipt">
        <ul>
          {rows.map((r) => (
            <li key={r.item} data-paid={r.paid}>
              <span>{r.item}</span>
              <b>{r.cost === 0 ? "free" : money(r.cost)}</b>
            </li>
          ))}
          <li className="kl-total">
            <span>One product, ready for two channels</span>
            <b>{money(c.total)}</b>
          </li>
        </ul>
        <div className="kl-plans" data-placeholder>
          <b>Placeholder: plans</b>
          <span>
            Kiln will be priced per listing kit, never per generation. The plans
            go here.
          </span>
        </div>
      </div>
    </section>
  );
}
