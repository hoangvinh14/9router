import { isDeepStrictEqual } from 'node:util';
import { supportsCommandCodeChatOriginal } from './accountedCommandCodeChatCandidate.js';
import { supportsCommandCodeOriginal } from './accountedCommandCodeCandidate.js';
import { ROLE, OPENAI_BLOCK } from '../translator/schema/index.js';

export const COMMANDCODE_CHAT_IDENTITY_FIELDS = Object.freeze(['threadId', 'workingDir', 'date', 'environment']);

// Equality oracle for already bounded plain snapshots, NOT an input guard or
// proof of where generated identity came from. The owner must retain identity
// independently before exposing transformed work. Never rerun mutable translator
// hooks, read ambient cwd/clock, or discard fields while checking equality.
export function validateCommandCodeChatConversion(original, model, identity, actual) {
  if (!supportsCommandCodeChatOriginal(original, model) || !identity || typeof identity !== 'object' || Array.isArray(identity) ||
      Object.keys(identity).length !== COMMANDCODE_CHAT_IDENTITY_FIELDS.length ||
      !COMMANDCODE_CHAT_IDENTITY_FIELDS.every(field => Object.hasOwn(identity, field))) return false;
  const expected = {
    threadId: identity.threadId,
    memory: '',
    config: {
      workingDir: identity.workingDir, date: identity.date, environment: identity.environment,
      structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [],
    },
    params: {
      model, stream: true, max_tokens: original.max_tokens, temperature: original.temperature,
      messages: [{ role: ROLE.USER, content: [{ type: OPENAI_BLOCK.TEXT, text: original.messages[0].content }] }],
    },
  };
  // Reuse canonical native validation for generated UUID/date/platform and full
  // wire shape. Matching actual data alone cannot bless an invalid identity.
  return supportsCommandCodeOriginal(expected, model) && isDeepStrictEqual(actual, expected);
}
