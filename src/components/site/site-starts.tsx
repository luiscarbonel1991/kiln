// The ways a product reaches Kiln, and what each one costs.
const STARTS: { how: string; note: string }[] = [
  {
    how: "a form",
    note: "Size, material, finish, colours, what the buyer personalizes, price. Free.",
  },
  {
    how: "a photo",
    note: "A text model fills the form from it, for about $0.03, on your click.",
  },
  {
    how: "a design file",
    note: "An SVG is drawn to scale and recoloured in each of your colours. Free.",
  },
  {
    how: "a sketch",
    note: "Redrawn as line art by an image model, then traced to an SVG for free.",
  },
  {
    how: "your whole catalog",
    note: "A JSON export from your own system, checked product by product. Free.",
  },
];

export function SiteStarts() {
  return (
    <section className="kl-band kl-starts" aria-labelledby="starts-title">
      <h2 id="starts-title">
        Start from {STARTS.slice(0, -1).map((s) => `${s.how}, `)}or{" "}
        {STARTS[STARTS.length - 1]?.how}.
      </h2>
      <ul>
        {STARTS.map((s) => (
          <li key={s.how}>
            <b>{s.how.replace(/^(a|your whole) /, "")}</b>
            <span>{s.note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
