import { describe, expect, it, vi } from 'vitest';
import { supportsGeminiRequest } from 'open-sse/config/accountedGeminiCandidate.js';
const metadata = () => ({ name: 'files/upload-1', uri: 'https://generativelanguage.googleapis.com/v1beta/files/upload-1', mimeType: 'video/mp4', sizeBytes: '17', sha256Hash: Buffer.alloc(32, 1).toString('base64'), createTime: '2026-10-03T00:00:00.000000001Z', updateTime: '2026-10-03T00:00:00.000000002Z', expirationTime: '2026-10-05T00:00:00.000000001Z', state: 'ACTIVE', source: 'UPLOADED' });
const parse = async value => (await import('open-sse/config/accountingGeminiFileMetadata.js')).captureGeminiUploadedFileMetadata(value);
describe('observed uploaded File metadata prerequisite, not gateway tenant, original source or usage authority', () => {
  it('captures complete observed ACTIVE UPLOADED identity without remapping original MIME/URI or manufacturing usage/tenant grants', async () => {
    const value = metadata(), before = structuredClone(value), observed = await parse(value); expect(observed).toEqual(before); expect(Object.isFrozen(observed)).toBe(true); expect(value).toEqual(before); value.name = 'files/changed'; expect(observed.name).toBe('files/upload-1');
    expect(observed).not.toHaveProperty('allowedInputModalities'); expect(observed).not.toHaveProperty('apiKeyId'); expect(observed).not.toHaveProperty('tokens');
    expect(supportsGeminiRequest({ contents: [{ parts: [{ fileData: { fileUri: before.uri, mimeType: before.mimeType } }] }] }, false, true, true, true, true, true, true, true, true, true)).toBe(false);
  });
  it('requires every observed identity/lifecycle field, ACTIVE and UPLOADED; no expired/processing/generated fallback or client-provided ownership', async () => {
    expect(await parse(metadata())).toEqual(metadata());
    for (const key of Object.keys(metadata())) { const value = metadata(); delete value[key]; await expect(parse(value)).rejects.toThrow(); }
    for (const change of [v => { v.state = 'PROCESSING'; }, v => { v.state = 'FAILED'; }, v => { v.state = 'STATE_UNSPECIFIED'; }, v => { v.source = 'GENERATED'; }, v => { v.source = 'SOURCE_UNSPECIFIED'; }, v => { v.source = null; }, v => { v.apiKeyId = 'claimed-owner'; }, v => { v.error = { message: 'private' }; }, v => { v.expirationTime = v.updateTime; }]) { const value = metadata(); change(value); await expect(parse(value)).rejects.toThrow(); }
  });
  it('requires exact canonical fixed-route name/URI identity and SHA256 bytes; never resolves arbitrary URLs or copies download authority', async () => {
    expect(await parse(metadata())).toEqual(metadata());
    for (const name of ['files/-bad', 'files/bad-', 'files/UPPER', 'files/a'.repeat(10), 'files/a/b', 'files/a%2fb', 'generatedFiles/upload-1']) { const value = metadata(); value.name = name; value.uri = 'https://generativelanguage.googleapis.com/v1beta/' + name; await expect(parse(value)).rejects.toThrow(); }
    for (const uri of ['https://evil.invalid/v1beta/files/upload-1', 'http://generativelanguage.googleapis.com/v1beta/files/upload-1', 'https://generativelanguage.googleapis.com:443/v1beta/files/upload-1', 'https://generativelanguage.googleapis.com/v1beta/files/other', 'https://generativelanguage.googleapis.com/v1beta/files/upload-1?key=secret', 'https://generativelanguage.googleapis.com/v1beta/files/upload-1#x', 'https://user:secret@generativelanguage.googleapis.com/v1beta/files/upload-1', 'files/upload-1', 'gs://bucket/object', 'https://www.youtube.com/watch?v=x']) { const value = metadata(); value.uri = uri; await expect(parse(value)).rejects.toThrow(); }
    for (const hash of ['YQ==', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), metadata().sha256Hash + '\n', null]) { const value = metadata(); value.sha256Hash = hash; await expect(parse(value)).rejects.toThrow(); }
    const download = metadata(); download.downloadUri = 'https://evil.invalid/private'; await expect(parse(download)).rejects.toThrow();
  });
  it('validates size as canonical observed int64 and exact nanosecond timestamp order; no duration/frame/token estimates', async () => {
    expect(await parse(metadata())).toEqual(metadata());
    for (const size of ['0', '9223372036854775807']) { const value = metadata(); value.sizeBytes = size; expect((await parse(value)).sizeBytes).toBe(size); }
    for (const size of ['-1', '01', '1e1', '9223372036854775808', 17, null]) { const value = metadata(); value.sizeBytes = size; await expect(parse(value)).rejects.toThrow(); }
    for (const change of [v => { v.updateTime = '2026-10-03T00:00:00.000000000Z'; }, v => { v.createTime = '2026-02-30T00:00:00Z'; }, v => { v.createTime = '2026-10-03T00:00:60Z'; }, v => { v.expirationTime = '2026-10-05T00:00:00.0000000001Z'; }, v => { v.createTime = '2026-10-03T00:00:00+00:00'; }]) { const value = metadata(); change(value); await expect(parse(value)).rejects.toThrow(); }
    const old = metadata(); old.createTime = old.updateTime = '2000-01-01T00:00:00Z'; old.expirationTime = '2000-01-03T00:00:00Z'; expect(await parse(old)).toEqual(old); // Shape/order parser is NOT current-expiration admission authority.
  });
  it('preserves selected image/PDF/audio/video MIME and optional bounded displayName; no sniffing or automatic source-control grants', async () => {
    for (const mimeType of ['image/png', 'application/pdf', 'audio/wav', 'video/mp4']) { const value = metadata(); value.mimeType = mimeType; value.displayName = 'private original display'; expect(await parse(value)).toEqual(value); }
    for (const change of [v => { v.mimeType = 'video/*'; }, v => { v.mimeType = 'video/mp4;codecs=avc1'; }, v => { v.displayName = 'x'.repeat(513); }, v => { v.displayName = null; }, v => { v.mediaProcessing = 'AGENTIC'; }, v => { v.tokens = 100; }]) { const value = metadata(); change(value); await expect(parse(value)).rejects.toThrow(); }
  });
  it('preserves exact timestamp precision, int64 boundaries and documented filename bounds without changing legal values', async () => {
    for (const suffix of ['', '.123', '.123456', '.123456789']) { const value = metadata(); value.createTime = value.updateTime = '2026-10-03T00:00:00' + suffix + 'Z'; expect(await parse(value)).toEqual(value); }
    for (const name of ['files/a', 'files/' + 'a'.repeat(40)]) { const value = metadata(); value.name = name; value.uri = 'https://generativelanguage.googleapis.com/v1beta/' + name; expect(await parse(value)).toEqual(value); }
    const long = metadata(); long.name = 'files/' + 'a'.repeat(41); long.uri = 'https://generativelanguage.googleapis.com/v1beta/' + long.name; await expect(parse(long)).rejects.toThrow();
    for (const stamp of ['0000-01-01T00:00:00Z', '2026-13-01T00:00:00Z', '2026-10-03T24:00:00Z', '2026-10-03T00:00:00.1Z', '2026-10-03T00:00:00Z\n']) { const value = metadata(); value.createTime = stamp; await expect(parse(value)).rejects.toThrow(); }
    const leap = metadata(); leap.createTime = leap.updateTime = '2024-02-29T00:00:00Z'; leap.expirationTime = '2024-03-01T00:00:00Z'; expect(await parse(leap)).toEqual(leap);
  });
  it('validates decoded Unicode display-name length and rejects invalid metadata containers or hidden fields', async () => {
    const unicode = metadata(); unicode.displayName = '🌱'.repeat(512); expect(await parse(unicode)).toEqual(unicode); unicode.displayName += '🌱'; await expect(parse(unicode)).rejects.toThrow();
    for (const value of [null, [], 'file', 1, { ...metadata(), ['__proto__']: { uri: 'private' } }]) await expect(parse(value)).rejects.toThrow();
    const hidden = metadata(); Object.defineProperty(hidden, 'private', { value: 'x', enumerable: false }); await expect(parse(hidden)).rejects.toThrow();
  });
  it('keeps PROCESSING grammar independent from ACTIVE default without relabeling metadata or accepting FAILED/generated states', async () => {
    const { captureGeminiProcessingFileMetadata: capture } = await import('open-sse/config/accountingGeminiFileMetadata.js');
    const processing = { ...metadata(), state: 'PROCESSING' }; expect(capture(processing)).toEqual(processing); expect(Object.isFrozen(capture(processing))).toBe(true); await expect(parse(processing)).rejects.toThrow(); expect(() => capture(metadata())).toThrow();
    for (const change of [v => { v.state = 'FAILED'; }, v => { v.source = 'GENERATED'; }, v => { delete v.sha256Hash; }, v => { v.fileUri = v.uri; }]) { const v = { ...processing }; change(v); expect(() => capture(v)).toThrow(); }
    const getter = vi.fn(); Object.defineProperty(processing, 'state', { enumerable: true, get: getter }); expect(() => capture(processing)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  it('rejects getters, proxies, inherited, own undefined and oversized captures without invoking programmable input', async () => {
    expect(await parse(metadata())).toEqual(metadata()); const getter = vi.fn(); const value = metadata(); Object.defineProperty(value, 'uri', { enumerable: true, get: getter }); await expect(parse(value)).rejects.toThrow(); expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn(); await expect(parse(new Proxy(metadata(), { get: trap, ownKeys: trap }))).rejects.toThrow(); expect(trap).not.toHaveBeenCalled();
    await expect(parse(Object.assign(Object.create({ inherited: 'x' }), metadata()))).rejects.toThrow(); const undef = metadata(); undef.displayName = undefined; await expect(parse(undef)).rejects.toThrow(); const big = metadata(); big.displayName = 'x'.repeat(262145); await expect(parse(big)).rejects.toThrow();
  });
});
