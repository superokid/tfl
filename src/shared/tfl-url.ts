/**
 * The only place TfL URLs are built. `app_key` sits in the query string, so a TfL URL is a secret:
 * pass anything that may contain one through `redact` before logging, throwing or returning it.
 */
export const TFL_BASE = 'https://api.tfl.gov.uk';

export function tflUrl(path: string, appKey: string, params: Record<string, string> = {}): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, TFL_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('app_key', appKey);
  return url.toString();
}

/** Removes any app_key value, e.g. from an error message or a URL. */
export function redact(text: string): string {
  return text.replace(/(app_key=)[^&\s"'#]*/gi, '$1REDACTED');
}
