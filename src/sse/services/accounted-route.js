import { unavailable } from '../../lib/accounting/attempt-payload.js';
import { isRequestedTargetAllowed } from './keyAccess.js';
import { getComboModels, getModelInfo } from './model.js';

// Validate a branch observed by the server's router, not a route supplied by a
// client. Capacity additions and helper calls need their own authority; they
// cannot use this ordinary combo membership check.
export async function checkAccountedRoute(snapshot, branch, selected) {
  if (!snapshot?.reads || !Array.isArray(branch) || !branch.length || branch.length > 16 ||
      branch.some(target => typeof target !== 'string' || !target) ||
      new Set(branch).size !== branch.length || !selected?.provider || !selected?.model) throw unavailable();
  const path = [...branch];
  const { provider, model: selectedModel } = selected;
  const reads = snapshot.reads;
  const combo = target => getComboModels(target, reads);
  const model = target => getModelInfo(target, reads);
  if (!await isRequestedTargetAllowed(snapshot.access, path[0], {
    getCombos: reads.getCombos, getComboModels: combo, getModelInfo: model,
  })) throw unavailable();
  for (let i = 1; i < path.length; i++) {
    if (!(await combo(path[i - 1]))?.includes(path[i])) throw unavailable();
  }
  const leaf = path.at(-1);
  const resolved = await model(leaf);
  if (!resolved?.provider || resolved.provider !== provider || resolved.model !== selectedModel) throw unavailable();
}
