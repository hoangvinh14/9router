import { getSettings } from '@/lib/localDb';
import { getComboModels, getModelInfo } from './model.js';
import { detectRequiredCapabilities } from 'open-sse/services/combo.js';
import { augmentModelsWithCapacityAdapter, getActiveAdapterStrategy } from 'open-sse/services/capacityAdapter.js';
import { snapshotAccountingGroup } from '@/lib/db/accountingGroupPayload.js';

// INTERNAL app resolver for bounded accounting preflight; NOT dispatch or schema
// eligibility. Persisted-material owner checks reads before/after every await.
export function createAccountingRoutingResolver(body) {
  const original = snapshotAccountingGroup([{ type: 'routing-body', value: body }])[0].value;
  const required = detectRequiredCapabilities(original);
  // Initial nested slice only. Other formats/tools/media remain unsupported
  // until preflight models their body-dependent routing transformations.
  const nestedTextEligible = !!original && Object.keys(original).every(k => ['model', 'messages', 'stream'].includes(k)) &&
    typeof original.model === 'string' && typeof original.stream === 'boolean' && Array.isArray(original.messages) &&
    original.messages.length > 0 && original.messages.every(m => m && typeof m === 'object' && !Array.isArray(m) &&
      Object.keys(m).every(k => ['role', 'content'].includes(k)) && ['system', 'developer', 'user', 'assistant'].includes(m.role) &&
      typeof m.content === 'string');
  return async (token, role) => {
    const settings = await getSettings();
    const models = await getComboModels(token);
    if (models) {
      const info = await getModelInfo(token);
      if (info.provider !== null) throw new Error('Accounting combo routing changed');
      const strategy = settings.comboStrategies?.[token]?.fallbackStrategy || settings.comboStrategy || 'fallback';
      const evidence = { strategy, nestedTextEligible, tuning: settings.comboStrategies?.[token]?.fusionTuning ?? null,
        sticky: settings.comboStickyRoundRobinLimit ?? null, required: [...required] };
      if (strategy === 'fusion') {
        const declared = settings.comboStrategies?.[token]?.judgeModel;
        // Match existing fusion's whitespace/default behavior, never coerce it.
        if (declared != null && typeof declared !== 'string') throw new Error('Accounting judge routing unavailable');
        return { id: info.model, kind: 'fusion', models, judge: declared?.trim() || models[0], evidence };
      }
      return { id: info.model, kind: 'fallback', models: augmentModelsWithCapacityAdapter(models, required, settings), evidence };
    }
    const info = await getModelInfo(token);
    if (!info.provider) throw new Error('Accounting model routing unavailable');
    // App only augments standalone leaves at the root. Combo candidates already
    // get capacity expansion at their enclosing fallback, not every leaf again.
    if (role === 'root') {
      const candidates = augmentModelsWithCapacityAdapter([token], required, settings);
      if (candidates.length > 1) return { id: 'capacity-root:' + token, kind: 'fallback', models: candidates,
        evidence: { strategy: getActiveAdapterStrategy(required, settings), required: [...required] } };
    }
    return { id: token, kind: 'leaf', provider: info.provider, model: info.model,
      evidence: { required: [...required] } };
  };
}
