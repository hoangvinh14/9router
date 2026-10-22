const fs = require('node:fs');
const path = require('node:path');
const root = process.env.DATA_DIR;
// Intercept the catalog at the server boundary; never fetch a live catalog.
globalThis.fetch = async (url) => {
  if (String(url) !== 'https://models.dev/api.json') throw new Error('Fixture blocks external fetch');
  const mode = fs.readFileSync(path.join(root, 'catalog-mode'), 'utf8');
  fs.appendFileSync(path.join(root, 'catalog-fetches.log'), `${mode}\n`);
  if (mode === 'offline') throw new Error('Fixture offline');
  const body = mode === 'malformed' ? '{invalid-json' : fs.readFileSync(path.join(__dirname, '../fixtures/pricing/models-dev-minimal.json'), 'utf8');
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
};
