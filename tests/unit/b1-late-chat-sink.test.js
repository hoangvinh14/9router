import { afterEach, describe, expect, it, vi } from 'vitest';
import { openChatFixture, rawUsage, fixtureProvider } from '../fixtures/accounting/chat-loopback.js';
import { associateChatAccountingFixture, captureChatAccounting } from '../../src/sse/services/chat-accounting.js';
import { normalizeOpenAIUsage, OPENAI_EXPLICIT_USAGE_PROFILE } from '../../open-sse/utils/accounting-openai-usage.js';

let fixture;
afterEach(async () => { vi.unstubAllEnvs(); if (fixture) { await fixture.close(); fixture = null; } });
for (const engine of ['node','sqljs']) describe(`${engine} B1 retained chat sink`, () => {
  it('accepts late exact evidence after absence and disposal with original price and period once', async () => {
    for (const name of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy']) vi.stubEnv(name, '');
    fixture = await openChatFixture(engine);
    let now = '2026-10-25T16:00:00.000Z';
    const request = new Request('http://localhost/v1/chat/completions', { headers: { authorization: 'Bearer fixture-secret' } });
    associateChatAccountingFixture(request, fixture.db, {}, { clock: () => now });
    const session = captureChatAccounting(request);
    session.authorizeTarget('fixture-node/fixture');
    const credentials = await session.credentials(fixtureProvider);
    const candidate = { provider: fixtureProvider, model: 'fixture', endpoint: 'chat', connectionId: credentials.connectionId };
    const bound = session.bind(candidate, credentials);
    const wire = { targetUrl: `${credentials.providerSpecificData.baseUrl}/chat/completions`, method: 'POST', body: JSON.stringify({ model: 'fixture' }) };
    const ticket = await bound.prepare(wire); ticket.assertDispatch(wire);
    await ticket.finish(null, 'stream_unknown', { kind: 'absent', interrupted: true });
    expect(fixture.db.get('SELECT state FROM apiKeyAccounting').state).toBe('unrecorded');
    session.dispose(); now = '2026-11-10T00:00:00.000Z';
    fixture.db.durableTransaction(() => fixture.db.run("UPDATE kv SET value=? WHERE scope='pricing'", [JSON.stringify({ fixture: { input:'9',output:'9' } })]));
    const usage = normalizeOpenAIUsage(rawUsage(), OPENAI_EXPLICIT_USAGE_PROFILE);
    await ticket.finish(usage, 'late_usage', { kind: 'valid', interrupted: true });
    await ticket.finish(usage, 'late_usage', { kind: 'valid', interrupted: true });
    expect(fixture.db.get('SELECT state,costNanoUsd,startedAt,resolutionVersion FROM apiKeyAccounting')).toMatchObject({ state:'settled',costNanoUsd:1200000,startedAt:'2026-10-25T16:00:00.000Z',resolutionVersion:2 });
    const conflicting = normalizeOpenAIUsage(rawUsage(400), OPENAI_EXPLICIT_USAGE_PROFILE);
    await expect(ticket.finish(conflicting, 'conflicting_late', { kind: 'valid', interrupted: true })).rejects.toThrow();
    expect(fixture.db.get('SELECT costNanoUsd FROM apiKeyAccounting').costNanoUsd).toBe(1200000);
    expect(fixture.db.get('SELECT count(*) AS n FROM apiKeyAccountingAudit').n).toBe(1);
  });
});
