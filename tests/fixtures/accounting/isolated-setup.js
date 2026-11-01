import { vi } from 'vitest';
import { assertAccountingIsolation } from './isolation-attestation.mjs';
assertAccountingIsolation();
// Legacy presentation-only writes are not settlement evidence. Disable them at
// the call boundary, before they create asynchronous tasks or flush timers.
// The DB driver, pricing resolver, accounting service/repo and actual fetch stay real.
vi.mock('@/lib/usageDb.js',()=>({
  appendRequestLog:vi.fn(async()=>{}),saveRequestDetail:vi.fn(async()=>{}),saveRequestUsage:vi.fn(async()=>{}),
  trackPendingRequest:vi.fn(),getActiveRequests:vi.fn(async()=>({activeRequests:[],recentRequests:[]})),
}));
