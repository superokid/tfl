const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
} as const;

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(BASE_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}
