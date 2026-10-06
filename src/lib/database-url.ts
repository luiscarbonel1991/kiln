// Which database a process uses. Mock runs (KILN_PROVIDERS=mock) never touch
// the live one: their jobs would otherwise put stub output on real cards and
// hold the card's one active job. A mock process uses KILN_MOCK_DATABASE_URL,
// else the live URL with "_mock" after the database name (kiln -> kiln_mock).
export function databaseUrlFor(input: {
  mode: "live" | "mock";
  databaseUrl?: string;
  mockDatabaseUrl?: string;
}): string | undefined {
  if (input.mode === "live") return input.databaseUrl;
  const url = input.mockDatabaseUrl ?? mockUrlOf(input.databaseUrl);
  if (url && url === input.databaseUrl) {
    throw new Error(
      "Mock mode needs its own database: KILN_MOCK_DATABASE_URL equals DATABASE_URL.",
    );
  }
  return url;
}

function mockUrlOf(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return undefined;
  const url = new URL(databaseUrl);
  const name = url.pathname.replace(/^\//, "");
  if (!name) return undefined;
  url.pathname = `/${name}_mock`;
  return url.toString();
}
