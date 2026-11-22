// Installed in src/lib/accounting by the internal Docker build only.
import fs from 'node:fs';
import { getAccountingAdapter } from '../db/driver.js';
import { verifyInternalAnthropicBinding } from './internal-binding.js';
import { ANTHROPIC_REFERENCE_MODEL } from './anthropic-reference-price.js';

const bindingPath = '/run/9router/accounting-binding.json';

function readBinding() {
  const fd = fs.openSync(bindingPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size === 0 || stat.size > 4096) return null;
    const bytes = Buffer.alloc(stat.size + 1);
    if (fs.readSync(fd, bytes, 0, bytes.length, 0) !== stat.size) return null;
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, stat.size)));
  } finally { fs.closeSync(fd); }
}

export async function findInstalledBudgetProfileForKey(keyId) {
  try {
    const binding = readBinding();
    if (!binding || binding.clientKeyId !== keyId) return null;
    verifyInternalAnthropicBinding(await getAccountingAdapter(), binding);
    return Object.freeze({ enabled: true, producerAdmitted: true, provider: 'anthropic', auth: 'api-key',
      model: ANTHROPIC_REFERENCE_MODEL, serviceTier: 'standard_only', inferenceGeo: 'global',
      workspaceBinding: Object.freeze(binding.workspaceBinding) });
  } catch { return null; }
}

export async function installedBudgetReadiness(keyId) {
  const ready = Boolean(await findInstalledBudgetProfileForKey(keyId));
  return { ready, reason: ready ? null : 'no_admitted_profile' };
}
