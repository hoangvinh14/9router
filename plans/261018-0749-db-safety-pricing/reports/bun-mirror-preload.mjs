import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './offline-preload.cjs';

const root = '/tmp/9router-db-safety-bun-ordinary-r4-pFyDh4';
const mirror = path.join(root, 'mirror');
const entry = path.join(root, 'harness/bun-ordinary-harness.mjs');
const aliases = new Map([
  ['@/lib/dataDir.js', path.join(mirror, 'src/lib/dataDir.js')],
  ['@/shared/constants/keyAccess.js', path.join(mirror, 'src/shared/constants/keyAccess.js')],
]);
Bun.plugin({
  name: 'owned-db-mirror',
  setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      let resolved;
      if (args.path.startsWith('node:') || args.path === 'bun:sqlite') {
        fs.appendFileSync(path.join(root, `evidence/bun-resolve-${process.pid}.jsonl`), JSON.stringify({ specifier: args.path, importer: args.importer, builtin: true }) + '\n');
        return;
      }
      if (aliases.has(args.path)) resolved = aliases.get(args.path);
      else if (args.path.startsWith('file:')) resolved = fileURLToPath(args.path);
      else if (path.isAbsolute(args.path)) resolved = args.path;
      else if (args.path.startsWith('.')) resolved = path.resolve(path.dirname(args.importer), args.path);
      else throw new Error(`Unowned bare import refused: ${args.path}`);
      const realpath = fs.realpathSync(resolved);
      if (realpath !== resolved || !(realpath.startsWith(mirror + path.sep) || realpath === entry)) throw new Error(`Unowned import refused: ${realpath}`);
      fs.appendFileSync(path.join(root, `evidence/bun-resolve-${process.pid}.jsonl`), JSON.stringify({ specifier: args.path, importer: args.importer, resolved: realpath }) + '\n');
      return { path: realpath };
    });
  },
});
