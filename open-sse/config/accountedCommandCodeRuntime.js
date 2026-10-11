import { snapshotAccountingPreparedData } from './accountedBaseDispatch.js';
import { COMMANDCODE_ENVIRONMENTS } from './accountedCommandCodeCandidate.js';

const FIELDS = Object.freeze(['workingDir', 'date', 'environment']);

// Only a shape guard for explicit, already selected runtime. No ambient reads
// and no assertion that caller-provided cwd/clock/platform has owner provenance.
export function captureAccountingCommandCodeRuntime(value) {
  const runtime = snapshotAccountingPreparedData(value);
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) || Object.keys(runtime).length !== FIELDS.length ||
      !FIELDS.every(key => Object.hasOwn(runtime, key)) || typeof runtime.workingDir !== 'string' || !runtime.workingDir.trim() ||
      runtime.workingDir.includes('\0') || !COMMANDCODE_ENVIRONMENTS.includes(runtime.environment) ||
      typeof runtime.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(runtime.date)) throw new Error('Accounting CommandCode runtime unavailable');
  const date = new Date(`${runtime.date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== runtime.date) throw new Error('Accounting CommandCode runtime unavailable');
  return runtime;
}
