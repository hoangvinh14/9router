import { readAccountingText } from './readAccountingJson.js';
import { createCommandCodeInitialErrorParser } from './accountingCommandCodeInitialErrorParser.js';

// Response-only helper for an already POSTed, independently admitted attempt.
// Not an executor, admission proof, success owner, or permission to retry.
export async function observeCommandCodeInitialFailure(response, { accounting, attempt, signal } = {}) {
  const parser = createCommandCodeInitialErrorParser();
  let receipt = null, failure = null;
  try {
    await readAccountingText(response, signal, { onChunk: chunk => parser.push(chunk) });
    receipt = parser.finish();
    if (!receipt) throw new Error('Missing raw CommandCode initial error');
  } catch (error) { failure = { error }; }
  // Claim once before awaiting completion. Storage/ACK failure must escape this
  // function, never become a read failure or trigger a second completion.
  const terminal = { usage: null, outcome: signal?.aborted ? 'aborted' : failure ? 'network_unknown' : 'failed' };
  await accounting.completeAttempt(attempt, terminal);
  // A later abort does not rewrite the terminal already handed to completion.
  signal?.throwIfAborted();
  accounting.gate();
  if (failure) throw failure.error;
  return receipt;
}
