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
    // Deliberately do not trust X-Forwarded-Host/Proto or a client Host override.
    // Reverse-proxy external-origin mapping needs separate deployment evidence.
    const origin = request.headers.get('origin');
    const fetchSite = request.headers.get('sec-fetch-site');
    try {
      const parsed = new URL(origin);
      if (!origin || parsed.origin !== origin || parsed.origin !== new URL(request.url).origin ||
          !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
          fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return refusal(403);
    } catch { return refusal(403); }
  }
  return null;
}
