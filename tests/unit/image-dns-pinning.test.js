// Mocked DNS/Agent handoff controls; no socket, live DNS or full SSRF certification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const seams = vi.hoisted(() => ({ lookup: vi.fn(), agent: vi.fn(), close: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: (...args) => seams.lookup(...args) }));
vi.mock('undici', () => ({ Agent: class FixtureAgent {
  constructor(options) { seams.agent(options); this.options = options; }
  close() { return seams.close(); }
} }));
import { fetchImageAsBase64 } from '../../open-sse/translator/concerns/image.js';
const originalFetch = globalThis.fetch;
const publicRecord = { address: '93.184.216.34', family: 4 };
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let fetch, cancel, read;
function response(bytes = png) {
  let sent = false;
  read = vi.fn(async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }));
  return { ok: true, body: { getReader: () => ({ read, cancel }) } };
}
beforeEach(() => {
  seams.lookup.mockReset(); seams.agent.mockReset(); seams.close.mockReset();
  seams.lookup.mockResolvedValue([publicRecord]); seams.close.mockResolvedValue(undefined);
  cancel = vi.fn(async () => {});
  fetch = vi.fn(async () => response()); globalThis.fetch = fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe('all-record image DNS guard and validated connect pin', () => {
  it.each(['10.0.0.5', '169.254.169.254', '::1', 'fd00::1'])('mixed public/private %s denies before Agent or fetch', async address => {
    seams.lookup.mockResolvedValue([publicRecord, { address, family: address.includes(':') ? 6 : 4 }]);
    expect(await fetchImageAsBase64('https://example.com/a.png')).toBeNull();
    expect(seams.lookup).toHaveBeenCalledExactlyOnceWith('example.com', { all: true });
    expect(seams.agent).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['empty', 'rejected'])('DNS %s denies before transport', async mode => {
    if (mode === 'empty') seams.lookup.mockResolvedValue([]);
    else seams.lookup.mockRejectedValue(new Error('Fixture DNS unavailable'));
    expect(await fetchImageAsBase64('https://example.com/a.png')).toBeNull();
    expect(seams.agent).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('hands validated IP/family to connect lookup without second DNS and forbids automatic redirects', async () => {
    expect((await fetchImageAsBase64('https://example.com/a.png')).mimeType).toBe('image/png');
    expect(seams.lookup).toHaveBeenCalledExactlyOnceWith('example.com', { all: true });
    expect(seams.agent).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
    const options = fetch.mock.calls[0][1];
    expect(options.redirect).toBe('manual'); expect(options.dispatcher.options).toBe(seams.agent.mock.calls[0][0]);
    const pinned = vi.fn();
    options.dispatcher.options.connect.lookup('example.com', { all: true }, pinned);
    expect(pinned).toHaveBeenCalledExactlyOnceWith(null, [publicRecord]);
    expect(seams.lookup).toHaveBeenCalledTimes(1); expect(seams.close).toHaveBeenCalledTimes(1);
  });
  it('redirect response to private URL is not followed or read', async () => {
    const redirected = response(); redirected.ok = false; redirected.status = 302;
    redirected.headers = new Headers({ location: 'http://169.254.169.254/metadata' });
    fetch.mockResolvedValue(redirected);
    expect(await fetchImageAsBase64('https://example.com/a.png')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].redirect).toBe('manual');
    expect(read).not.toHaveBeenCalled(); expect(seams.close).toHaveBeenCalledTimes(1);
  });
  it('oversize response reaches bounded reader, cancels once and closes dispatcher', async () => {
    fetch.mockImplementation(async () => response(new Uint8Array(101)));
    expect(await fetchImageAsBase64('https://example.com/a.png', { maxBytes: 100 })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1); expect(seams.close).toHaveBeenCalledTimes(1);
  });
  it('non-image magic is rejected after actual mocked EOF, not by DNS mismatch', async () => {
    fetch.mockImplementation(async () => response(new Uint8Array([60, 63, 112, 104, 112])));
    expect(await fetchImageAsBase64('https://example.com/a.png')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).not.toHaveBeenCalled(); expect(seams.close).toHaveBeenCalledTimes(1);
  });
});
