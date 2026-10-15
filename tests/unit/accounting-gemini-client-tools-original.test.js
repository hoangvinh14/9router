import { describe, it, expect, vi } from 'vitest';
import { supportsGeminiRequest, supportsGeminiInternalRequest } from 'open-sse/config/accountedGeminiCandidate.js';
const original = () => ({ contents: [
  { role: 'user', parts: [{ text: 'private request' }] },
  { role: 'model', parts: [{ functionCall: { id: 'opaque_call', name: 'lookup', args: { q: 'private query' } }, thoughtSignature: 'b3BhcXVl' }] },
  { role: 'user', parts: [{ functionResponse: { id: 'opaque_call', name: 'lookup', response: { error: 'private error', nested: [1, { ok: false }] } } }] },
], tools: [{ functionDeclarations: [{ name: 'lookup', description: 'Private client lookup', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } }, required: ['q'] } }] }],
  toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['lookup'] } }, generationConfig: { maxOutputTokens: 100, candidateCount: 1 } });
describe('isolated original Gemini client function/history prerequisite, no owner or POST grant', () => {
  it('explicit strict opt-in validates and conserves full declaration/config/history/signature without executing clients', () => {
    const body = original(), before = structuredClone(body);
    expect(supportsGeminiRequest(body, true)).toBe(true); expect(body).toEqual(before);
    expect(supportsGeminiInternalRequest({ ...body, model: 'fixture-gemini', stream: true }, 'fixture-gemini', true)).toBe(true);
    expect(supportsGeminiRequest(body)).toBe(false); for (const flag of [false, 1, 'true', null, {}]) expect(supportsGeminiRequest(body, flag)).toBe(false);
  });
  it('parallel same-name calls bind matching opaque IDs, name-only calls require unambiguous matching original result', () => {
    const body = original(); body.contents[1].parts.push({ functionCall: { id: 'other', name: 'lookup', args: {} } });
    body.contents[2].parts.push({ functionResponse: { id: 'other', name: 'lookup', response: {} } }); expect(supportsGeminiRequest(body, true)).toBe(true);
    const noId = original(); delete noId.contents[1].parts[0].functionCall.id; delete noId.contents[2].parts[0].functionResponse.id;
    expect(supportsGeminiRequest(noId, true)).toBe(true);
    noId.contents[1].parts.push({ functionCall: { name: 'lookup', args: {} } }); expect(supportsGeminiRequest(noId, true)).toBe(false);
    body.contents[2].parts[1].functionResponse.id = 'foreign'; expect(supportsGeminiRequest(body, true)).toBe(false);
  });
  it('undeclared/reused/unresolved/role-inverted client history and mismatched names cannot be erased into text authority', () => {
    expect(supportsGeminiRequest(original(), true)).toBe(true);
    for (const mutate of [
      b => { b.contents[1].parts[0].functionCall.name = 'unknown'; },
      b => { b.contents[2].parts[0].functionResponse.name = 'unknown'; },
      b => { b.contents[2].parts[0].functionResponse.id = 'foreign'; },
      b => { b.contents.splice(2, 1); },
      b => { b.contents[1].role = 'user'; },
      b => { b.contents[2].role = 'model'; },
      b => { b.contents.push(...structuredClone(b.contents.slice(1))); },
      b => { b.contents[1].parts[0].text = 'double data union'; },
      b => { b.contents[2].parts[0].functionResponse.response = null; },
    ]) { const body = original(); mutate(body); expect(supportsGeminiRequest(body, true)).toBe(false); }
  });
  it('optional args/signatures and declaration JSON Schema are preserved; typed openapi schemas cannot accept unknown or conflicting fields', () => {
    const body = original(); delete body.contents[1].parts[0].functionCall.args; delete body.contents[1].parts[0].thoughtSignature;
    const tool = body.tools[0].functionDeclarations[0]; delete tool.parameters;
    tool.parametersJsonSchema = { type: 'object', properties: { q: { type: 'string' } }, additionalProperties: false }; tool.responseJsonSchema = { type: 'object' };
    expect(supportsGeminiRequest(body, true)).toBe(true); tool.parameters = { type: 'OBJECT' }; expect(supportsGeminiRequest(body, true)).toBe(false);
    for (const mutate of [b => { b.tools[0].functionDeclarations[0].parameters.type = 'ALIEN'; }, b => { b.tools[0].functionDeclarations[0].unknown = true; },
      b => { b.tools[0].functionDeclarations.push(structuredClone(b.tools[0].functionDeclarations[0])); }, b => { b.contents[1].parts[0].thoughtSignature = ''; }]) {
      const value = original(); mutate(value); expect(supportsGeminiRequest(value, true)).toBe(false);
    }
  });
  it('calling-mode permission and client-only classification do not authorize hosted/server tools, nonblocking/media, cached resources or arbitrary config', () => {
    expect(supportsGeminiRequest(original(), true)).toBe(true);
    for (const mode of ['AUTO', 'NONE', 'VALIDATED']) {
      const body = original(); body.toolConfig.functionCallingConfig.mode = mode;
      if (mode !== 'VALIDATED') delete body.toolConfig.functionCallingConfig.allowedFunctionNames;
      expect(supportsGeminiRequest(body, true)).toBe(true);
    }
    for (const mutate of [b => { b.toolConfig.functionCallingConfig.allowedFunctionNames = ['foreign']; }, b => { b.toolConfig.functionCallingConfig.mode = 'OTHER'; },
      b => { b.tools.push({ googleSearch: {} }); }, b => { b.tools.push({ codeExecution: {} }); }, b => { b.toolConfig.includeServerSideToolInvocations = true; },
      b => { b.cachedContent = 'cachedContents/unowned'; }, b => { b.tools[0].functionDeclarations[0].behavior = 'NON_BLOCKING'; },
      b => { b.contents[2].parts[0].functionResponse.parts = [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }]; },
      b => { b.contents[2].parts[0].functionResponse.willContinue = true; }]) {
      const body = original(); mutate(body); expect(supportsGeminiRequest(body, true)).toBe(false);
    }
  });
  it('preserves mixed text/call position and sequential id-less rounds while refusing a new model turn before pending results', () => {
    const body = original(); body.contents[1].parts.unshift({ text: 'private thinking summary', thought: true, thoughtSignature: 'b3BhcXVl' });
    body.contents[1].parts.push({ text: 'private after call' }); expect(supportsGeminiRequest(body, true)).toBe(true);
    body.contents.splice(2, 0, { role: 'model', parts: [{ text: 'unresolved new model turn' }] }); expect(supportsGeminiRequest(body, true)).toBe(false);
    const rounds = original(); delete rounds.contents[1].parts[0].functionCall.id; delete rounds.contents[2].parts[0].functionResponse.id;
    rounds.contents.push(...structuredClone(rounds.contents.slice(1))); expect(supportsGeminiRequest(rounds, true)).toBe(true);
  });
  it('OpenAPI int64 lexical limits and schema relationships preserve explicit type/precision without dereferencing JSON schema', () => {
    const body = original(), schema = body.tools[0].functionDeclarations[0].parameters;
    Object.assign(schema, { minProperties: '1', maxProperties: '9223372036854775807', propertyOrdering: ['q'] }); expect(supportsGeminiRequest(body, true)).toBe(true);
    for (const mutate of [s => { s.maxProperties = '9223372036854775808'; }, s => { s.maxProperties = 3; }, s => { s.minProperties = '04'; },
      s => { s.required = ['unknown']; }, s => { s.propertyOrdering = ['q', 'q']; }, s => { s.minimum = 10; s.maximum = 1; }]) {
      const value = original(); mutate(value.tools[0].functionDeclarations[0].parameters); expect(supportsGeminiRequest(value, true)).toBe(false);
    }
    const json = original(); delete json.tools[0].functionDeclarations[0].parameters;
    json.tools[0].functionDeclarations[0].parametersJsonSchema = { type: 'object', properties: { x: { $ref: 'https://example.com/unretrieved' } } };
    expect(supportsGeminiRequest(json, true)).toBe(true);
  });
  it('plain bounded capture precedes traversing programmable original/tool values and cannot mutate or retain corpus', () => {
    expect(supportsGeminiRequest(original(), true)).toBe(true);
    const getter = vi.fn(() => original().tools), trap = vi.fn();
    expect(supportsGeminiRequest(Object.defineProperty(original(), 'tools', { enumerable: true, get: getter }), true)).toBe(false); expect(getter).not.toHaveBeenCalled();
    expect(supportsGeminiRequest(new Proxy(original(), { ownKeys: trap }), true)).toBe(false); expect(trap).not.toHaveBeenCalled();
    const internalGetter = vi.fn(); expect(supportsGeminiInternalRequest(Object.defineProperty({ ...original(), stream: true }, 'model', { enumerable: true, get: internalGetter }), 'fixture-gemini', true)).toBe(false); expect(internalGetter).not.toHaveBeenCalled();
    const body = original(); body.contents[2].parts[0].functionResponse.response.huge = 'x'.repeat(262145); expect(supportsGeminiRequest(body, true)).toBe(false);
    expect(supportsGeminiRequest(Object.assign(Object.create({ hostile: true }), original()), true)).toBe(false);
  });
});
