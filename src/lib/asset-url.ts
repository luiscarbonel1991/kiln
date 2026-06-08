// True when a URL points at a real, loadable asset (S3 / http(s) / data: / blob:),
// not a non-resolving "stub.local" URL from a mock provider. The UI renders real
// URLs as <img>/<video> and stubs as the deterministic gradient placeholder.
export function isRenderableUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  if (url.includes("stub.local")) return false;
  return /^(https?:|blob:|data:)/.test(url);
}
