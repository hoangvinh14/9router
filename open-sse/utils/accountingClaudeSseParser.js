import { createBufferedClaudeUsageObserver } from './accountingClaudeUsage.js';

// Default text-only live Messages framing reuses the raw protocol validator.
// Client tools require explicit boolean opt-in and bounded full JSON validation.
// Existing event/chunk/terminal/ready byte bounds apply; the buffered whole-body
// reader's total/event limits are not a live-stream total-output restriction.
export function createAccountingClaudeSseParser(onEvent, { expectedModel, ...limits } = {}) {
  const observer = createBufferedClaudeUsageObserver({ ...limits, expectedModel, captureMessage: false, onEvent });
  return { push: chunk => observer.push(chunk), finish: () => observer.finish(), evidence: () => null };
}
