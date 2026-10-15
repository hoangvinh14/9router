// Internal exact issued request identity only; methods copied onto caller-shaped
// objects cannot manufacture the app's current resource/terminal authority.
const owners = new WeakMap();
export async function bindGeminiOwnedRequestOwner(accounting, controls) {
  // Avoid a static app↔candidate/dispatch import cycle. No owner is observable
  // until the actual app module has verified its private issued-control pair.
  const { assertGeminiOwnedRequestControls } = await import('../../src/lib/apiKeyBudget/requestAccounting.js');
  // Assertion uses the app module's private origin map/exact controls identity;
  // a caller callback or shape can never stand in for this issuer proof.
  assertGeminiOwnedRequestControls(accounting, controls);
  if (!accounting || owners.has(accounting) || !Object.isFrozen(accounting) ||
      !controls || !['capture', 'videoMetadata', 'videoResolution', 'clientTools', 'inlineMedia', 'inlineAudio', 'inlineVideo', 'inspect', 'parser', 'terminal'].every(key => typeof controls[key] === 'function')) throw new Error('Owned Gemini request owner unavailable');
  owners.set(accounting, Object.freeze({ ...controls }));
}
export function getGeminiOwnedRequestOwner(accounting) {
  const owner = owners.get(accounting);
  if (!owner) throw new Error('Owned Gemini request owner unavailable');
  return owner;
}
