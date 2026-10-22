const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const tls = require('node:tls');
(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://example.com/' }); res.end(); }
    else res.end('owned-loopback');
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(base)).text(), 'owned-loopback');
    for (const url of ['bad-url', 'http://example.com', 'http://203.0.113.3', 'http://user:pass@127.0.0.1', 'https://127.0.0.1', 'http://localhost']) {
      assert.throws(() => fetch(url), /Pricing fixture:/);
    }
    assert.throws(() => net.createConnection({ path: '/tmp/fixture-unix-not-created' }), /non-loopback/);
    assert.throws(() => net.createConnection({ host: 'example.com', port: 80 }), /non-loopback/);
    assert.throws(() => tls.connect({ host: '127.0.0.1', port: 443 }), /TLS disabled/);
    await assert.rejects(fetch(`${base}/redirect`));
    console.log(JSON.stringify({ success: true, controls: 11, boundary: 'selected-JS numeric loopback only, all local ports addressable; not OS sandbox' }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
