#!/usr/bin/env node
import { initializePoliciesOffline } from '../src/lib/db/offlinePolicyInitialization.js';
const args = process.argv.slice(2);
try {
  const recover = args[0] === 'recover';
  if (!['initialize', 'recover'].includes(args[0]) || args.length !== (recover ? 3 : 5)) throw new Error('Invalid offline arguments');
  const [mode, directory, engine, actor, reason] = args;
  if (!mode || !['node:sqlite', 'sql.js'].includes(engine)) throw new Error('Invalid offline engine');
  const result = await initializePoliciesOffline({ directory, engine, actor, reason, recover });
  console.log(JSON.stringify(result));
} catch {
  // No raw SQL, credential, binding material, path or untrusted error message.
  console.error('Offline policy operation failed; keep all artifacts. Usage: api-key-policy-init.mjs initialize <existing DATA_DIR> <node:sqlite|sql.js> <actor> <reason>, or recover <existing DATA_DIR> <engine>.');
  process.exitCode = 1;
}
