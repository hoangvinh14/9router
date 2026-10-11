import { types } from 'node:util';
import { captureAccountedCommandCodeChatOwner } from './accountedCommandCodeChatGeneration.js';
import { ACCOUNTED_COMMANDCODE_CHAT_RETRY_MODE, ACCOUNTED_COMMANDCODE_CHAT_RETRY_LIMIT,
  ACCOUNTED_COMMANDCODE_CHAT_RETRY_DELAY_MS, ACCOUNTED_COMMANDCODE_CHAT_RETRY_STATUSES } from '../config/accountedCommandCodeChatRetry.js';

function wait(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

// This path does NOT call Base retries or the legacy early-cancelling inspector.
// A successor is reachable only through this owner's raw initial-error receipt,
// whose observer already awaited own completion delivery and the fresh gate.
export async function executeAccountedCommandCodeChatRetry(executor, options) {
  if (!options || typeof options !== 'object' || types.isProxy(options) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(options))) throw new Error('Accounting CommandCode Chat retry unavailable');
  const descriptors = Object.getOwnPropertyDescriptors(options), projected = {};
  const allowed = ['model', 'body', 'stream', 'credentials', 'connectionId', 'providerOverrides', 'proxyOptions', 'accounting', 'signal', 'accountingMode', 'log'];
  for (const key of Reflect.ownKeys(descriptors)) {
    const field = descriptors[key];
    if (typeof key !== 'string' || !allowed.includes(key) || !field.enumerable || !Object.hasOwn(field, 'value')) throw new Error('Accounting CommandCode Chat retry unavailable');
    if (key !== 'accountingMode' && key !== 'log') projected[key] = field.value;
  }
  if (descriptors.accountingMode?.value !== ACCOUNTED_COMMANDCODE_CHAT_RETRY_MODE) throw new Error('Accounting CommandCode Chat retry unavailable');
  const owner = captureAccountedCommandCodeChatOwner(executor, projected);
  for (let generation = 0; generation <= ACCOUNTED_COMMANDCODE_CHAT_RETRY_LIMIT; generation++) {
    const result = await owner.executeGeneration();
    const receipt = result.commandCodeInitialFailure;
    if (!receipt || !ACCOUNTED_COMMANDCODE_CHAT_RETRY_STATUSES.includes(receipt.statusCode) || generation === ACCOUNTED_COMMANDCODE_CHAT_RETRY_LIMIT) return result;
    await wait(ACCOUNTED_COMMANDCODE_CHAT_RETRY_DELAY_MS * (generation + 1), projected.signal);
    // Fresh gate/admission happen inside executeGeneration after the backoff.
    // No catch here: lost terminal handles/persistence/gate failures escape.
  }
}
