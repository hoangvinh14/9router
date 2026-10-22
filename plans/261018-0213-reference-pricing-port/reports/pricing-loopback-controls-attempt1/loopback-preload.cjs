// Test-only selected-JS egress boundary, NOT an OS/native network sandbox.
// Permit numeric loopback TCP only. This is NOT an ownership boundary: all
// local ports are addressable; suites must use only their own ephemeral ports.
// Never resolve arbitrary hostnames or permit outbound TLS/provider IO.
const net = require('node:net');
const tls = require('node:tls');
const originalConnect = net.Socket.prototype.connect;
const originalFetch = globalThis.fetch;
function allowed(options) {
  return options && !options.path && ['127.0.0.1', '::1'].includes(options.host || options.hostname)
    && Number.isInteger(Number(options.port)) && Number(options.port) > 0 && Number(options.port) <= 65535;
}
net.Socket.prototype.connect = function (...args) {
  const [options] = net._normalizeArgs(args);
  if (!allowed(options)) throw new Error('Pricing fixture: non-loopback network disabled');
  return originalConnect.apply(this, args);
};
tls.connect = () => { throw new Error('Pricing fixture: TLS disabled'); };
globalThis.fetch = (input, init) => {
  let url;
  try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); }
  catch { throw new Error('Pricing fixture: invalid fetch target'); }
  if (url.protocol !== 'http:' || url.username || url.password || !['127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Pricing fixture: external fetch disabled');
  return originalFetch(input, { ...init, redirect: 'error' });
};
require('node:module').syncBuiltinESMExports();
