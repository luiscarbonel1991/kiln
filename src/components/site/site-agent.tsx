// The other way in: the maker's own assistant, connected to Kiln's MCP server,
// runs the kit in words. The exchange shown is what the tools answer: a quote
// first, then the maker's ok.
const CONNECT = [
  "claude mcp add --transport http kiln \\",
  "  http://127.0.0.1:3009/api/mcp \\",
  '  --header "Authorization: Bearer $KILN_TOKEN"',
].join("\n");

const RULES = [
  "It quotes the price before every paid step.",
  "A token spends only if you switch that on.",
  "It approves no photo it has not looked at.",
  "Publishing stays yours.",
];

export function SiteAgent() {
  return (
    <section
      id="agent"
      className="kl-band kl-after kl-agent"
      aria-labelledby="agent-title"
    >
      <div>
        <h2 id="agent-title">Or hand the whole kit to your AI.</h2>
        <p>
          Kiln is an MCP server. Connect Claude, or any assistant that speaks
          MCP, and ask in plain words: import the catalog, start the kit, take
          the scenes, look at each one, write the listing. It runs the same
          steps you would on the board, and Kiln has its own chat if you would
          rather stay inside.
        </p>
        <ul className="kl-rules">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
      <div>
        <figure className="kl-term">
          <figcaption>Connect it once</figcaption>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling command must be reachable by keyboard */}
          <pre tabIndex={0}>
            <code>{CONNECT}</code>
          </pre>
        </figure>
        <div className="kl-approval" aria-hidden>
          <p>Start a launch kit for the coaster and take its scenes.</p>
          <div>
            <span>Waits for your ok</span>
            <b>3 scenes · Etsy · ≈ $0.28</b>
            <i>
              <em>Approve</em>
              <em>Not now</em>
            </i>
          </div>
        </div>
      </div>
    </section>
  );
}
