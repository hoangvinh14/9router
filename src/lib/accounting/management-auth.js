// Accounting management never inherits requireLogin=false, local/CLI tokens or
// an inference API key as admin authority. Use the existing signed session only.
const refusal = status => Response.json({ error: { message: status === 401 ? 'Dashboard session required' : 'Invalid request origin' } },
  { status, headers: { 'cache-control': 'no-store' } });

export async function requireAccountingAdmin(request, mutation = false) {
  const token = request.cookies?.get?.('auth_token')?.value;
  if (typeof token !== 'string' || !token) return refusal(401);
  let session;
  try {
    const { getDashboardAuthSession } = await import('../auth/dashboardSession.js');
    session = await getDashboardAuthSession(token);
  } catch { return refusal(401); }
  if (session?.authenticated !== true || session.mustChangePassword === true) return refusal(401);
  if (mutation) {
    // Standalone Next can form request.url from the listener hostname.
    // BASE_URL is the operator's public URL and never comes from request headers.
    const origin = request.headers.get('origin');
    const fetchSite = request.headers.get('sec-fetch-site');
    try {
      const parsed = new URL(origin);
      const expected = new URL(process.env.BASE_URL || request.url);
      if (!origin || parsed.origin !== origin || parsed.origin !== expected.origin ||
          expected.username || expected.password ||
          !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
          fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return refusal(403);
    } catch { return refusal(403); }
  }
  return null;
}
