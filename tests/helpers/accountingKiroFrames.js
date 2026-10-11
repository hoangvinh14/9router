// Independent wire-fixture encoder: not the production CRC/decoder.
const encoder = new TextEncoder();
export function fixtureCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function concatFixtureBytes(chunks) {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
export function fixtureHeader(name, value, type = 7) {
  const nameBytes = typeof name === 'string' ? encoder.encode(name) : name;
  const valueBytes = typeof value === 'string' ? encoder.encode(value) : value;
  const sized = type === 6 || type === 7;
  const result = new Uint8Array(2 + nameBytes.byteLength + (sized ? 2 : 0) + valueBytes.byteLength);
  result[0] = nameBytes.byteLength; result.set(nameBytes, 1);
  let offset = 1 + nameBytes.byteLength; result[offset++] = type;
  if (sized) { new DataView(result.buffer).setUint16(offset, valueBytes.byteLength, false); offset += 2; }
  result.set(valueBytes, offset);
  return result;
}
export function checksumFixtureFrame(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(8, fixtureCrc32(bytes.subarray(0, 8)), false);
  view.setUint32(bytes.byteLength - 4, fixtureCrc32(bytes.subarray(0, bytes.byteLength - 4)), false);
  return bytes;
}
export function fixtureFrame(headers, payload) {
  const headerBytes = concatFixtureBytes(headers);
  const payloadBytes = payload instanceof Uint8Array ? payload : encoder.encode(JSON.stringify(payload));
  const result = new Uint8Array(16 + headerBytes.byteLength + payloadBytes.byteLength);
  const view = new DataView(result.buffer);
  view.setUint32(0, result.byteLength, false); view.setUint32(4, headerBytes.byteLength, false);
  result.set(headerBytes, 12); result.set(payloadBytes, 12 + headerBytes.byteLength);
  return checksumFixtureFrame(result);
}
export function fixtureKiroEvent(eventType, payload) {
  return fixtureFrame([fixtureHeader(':event-type', eventType)], payload);
}
