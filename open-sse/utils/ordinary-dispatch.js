import { AsyncLocalStorage } from 'node:async_hooks';

// Next can bundle the same boundary in several routes in one server process.
const key = Symbol.for('9router.ordinary-dispatch.v1');
const state = globalThis[key] ??= { scope: new AsyncLocalStorage(), opaque: new Map() };

export function withOrdinaryDispatch(secrets, check, run) {
  const parent = state.scope.getStore();
  const context = { secrets: [...new Set([...(parent?.secrets ?? []), ...secrets])],
    check: () => (!parent || !parent.refused && parent.check()) && check(), refused: false };
  return state.scope.run(context, () => run(context));
}

export function assertOrdinaryDispatch() {
  const context = state.scope.getStore();
  if (!context || (!context.refused && context.check())) return;
  context.refused = true;
  throw new Error('API key accounting changed before upstream dispatch');
}

// A browser can send from another process after Playwright yields. Hold first
// activation until this operation has a response or has shut its page down.
export async function withOpaqueOrdinaryDispatch(run) {
  const context = state.scope.getStore();
  if (!context) return run();
  assertOrdinaryDispatch();
  for (const secret of context.secrets) {
    state.opaque.set(secret, (state.opaque.get(secret) ?? 0) + 1);
  }
  try { return await run(); }
  finally {
    for (const secret of context.secrets) {
      const remaining = state.opaque.get(secret) - 1;
      if (remaining) state.opaque.set(secret, remaining);
      else state.opaque.delete(secret);
    }
  }
}

export const hasOpaqueOrdinaryDispatch = secret => state.opaque.has(secret);
export const ordinaryDispatchRefused = () => state.scope.getStore()?.refused === true;
