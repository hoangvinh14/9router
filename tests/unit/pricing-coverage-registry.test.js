import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), coverage: vi.fn(), query: vi.fn() }));
vi.mock('@/lib/auth/managementGuard.js', () => ({ authorizeManagement: mocks.authorize }));
vi.mock('@/lib/pricing/coverageReport.js', () => ({ getPricingCoverage: mocks.coverage, pricingCoverageQuery: mocks.query }));
import { GET } from '@/app/api/pricing/coverage/route.js';
beforeEach(() => { vi.resetAllMocks(); mocks.authorize.mockResolvedValue({ actor: 'fixture' }); mocks.query.mockReturnValue({ limit: 50, offset: 0, revision: null }); });
describe('coverage route response boundary', () => {
  it('authorizes before parsing query or reading coverage', async () => {
    mocks.authorize.mockResolvedValue({ response: new Response('denied', { status: 401 }) });
    expect((await GET(new NextRequest('http://localhost/api/pricing/coverage?url=secret'))).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.coverage).not.toHaveBeenCalled();
  });
  it('returns no-store data and explicitly forwards a stale revision conflict', async () => {
    mocks.coverage.mockResolvedValue({ revision: 'a'.repeat(64), usageCertified: false });
    const req = new NextRequest('http://localhost/api/pricing/coverage');
    const response = await GET(req); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ usageCertified: false });
    mocks.coverage.mockRejectedValue(Object.assign(new Error('SECRET'), { status: 409 }));
    const conflict = await GET(req); expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'Pricing changed; restart coverage pagination', code: 'pricing_coverage_revision_changed' });
  });
  it('redacts all unexpected storage and query failures', async () => {
    const req = new NextRequest('http://localhost/api/pricing/coverage');
    for (const [error, expected] of [[Object.assign(new Error('SECRET'), { status: 400 }), 400], [new Error('SECRET'), 503], [null, 503]]) {
      mocks.coverage.mockRejectedValue(error); const response = await GET(req); expect(response.status).toBe(expected); expect(response.headers.get('cache-control')).toBe('no-store'); expect(JSON.stringify(await response.json())).not.toContain('SECRET');
    }
  });
});
