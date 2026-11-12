// Whether a request's Host names this machine only. Kiln has no login, so
// any other address means people besides the maker may be able to open it.
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return true;
  const name = host
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/^\[|\]$/g, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(name)
  );
}
