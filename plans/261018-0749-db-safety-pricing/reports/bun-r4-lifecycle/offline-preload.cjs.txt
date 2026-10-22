// Baseline containment only: selected suites own no network behavior.
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const deny = () => { throw new Error('P1 baseline: network disabled'); };
net.Socket.prototype.connect = deny;
net.connect = net.createConnection = deny;
tls.connect = deny;
http.request = http.get = https.request = https.get = deny;
globalThis.fetch = deny;
require('node:module').syncBuiltinESMExports();
