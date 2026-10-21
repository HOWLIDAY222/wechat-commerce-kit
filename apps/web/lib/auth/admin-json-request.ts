/** Cookie-authenticated JSON actions must originate from this admin host. */
export function isSameHostAdminJson(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json') || request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true; // Internal authenticated server clients omit Origin.
  try { return new URL(origin).host.toLowerCase() === (request.headers.get('host') || new URL(request.url).host).toLowerCase(); }
  catch { return false; }
}
