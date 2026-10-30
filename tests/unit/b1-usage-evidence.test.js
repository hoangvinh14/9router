import { describe, expect, it } from 'vitest';
import { createUsageObservation, OPENAI_EXPLICIT_USAGE_PROFILE as profile } from '../../open-sse/utils/accounting-openai-usage.js';
import { createAccountedBoundary } from '../../open-sse/executors/accounted-base.js';
import { createAccountedStream } from '../../open-sse/utils/accounting-openai-stream.js';
import { rawUsage } from '../fixtures/accounting/chat-loopback.js';

describe('B1 classified producer evidence', () => {
  it('retains authoritative SSE usage before EOF without fabricating completion', async () => {
    const calls = [];
    const frame = value => `data: ${JSON.stringify(value)}\n\n`;
    const response = createAccountedStream(new Response(frame({ choices: [], usage: rawUsage() })),
      { finish: async (...args) => calls.push(args) }, { profile });
    await expect(response.text()).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ exact: true });
    expect(calls[0][2]).toMatchObject({ kind: 'valid', interrupted: true });
  });
  it('captures cancellation evidence once and ignores a racing unread usage chunk', async () => {
    let upstream;
    const calls = [];
    const response = createAccountedStream(new Response(new ReadableStream({ start(controller) { upstream = controller; } })),
      { finish: async (...args) => calls.push(args) }, { profile });
    const reader = response.body.getReader();
    const pending = reader.read();
    const cancel = reader.cancel();
    // Cancellation owns the terminal before any later raw read continuation.
    await cancel; await pending;
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toEqual({ kind: 'absent', interrupted: true });
    expect(() => upstream.enqueue(new TextEncoder().encode('data: {}\\n\\n'))).toThrow();
  });
  it.each(['data: {"usage":', new Uint8Array([0xff])])('does not exempt malformed or partial SSE as absent', async bytes => {
    const calls = [];
    const response = createAccountedStream(new Response(bytes), { finish: async (...args) => calls.push(args) }, { profile });
    await expect(response.text()).rejects.toThrow();
    expect(calls).toHaveLength(1); expect(calls[0][0]).toBeNull();
    expect(calls[0][2]).toMatchObject({ kind: 'malformed' });
  });
  it('distinguishes absent, malformed, valid and conflicting observations', () => {
    const observation = createUsageObservation(profile);
    expect(observation.evidence()).toEqual({ kind: 'absent' });
    observation.observe(rawUsage());
    expect(observation.evidence()).toMatchObject({ kind: 'valid', usage: { exact: true } });
    observation.observe(rawUsage(401));
    expect(observation.evidence()).toEqual({ kind: 'conflicting' });
    const invalid = createUsageObservation(profile); invalid.observe(null);
    expect(invalid.evidence()).toEqual({ kind: 'malformed' });
    invalid.observe(rawUsage()); expect(invalid.evidence()).toEqual({ kind: 'malformed' });
    const validThenMalformed = createUsageObservation(profile); validThenMalformed.observe(rawUsage()); validThenMalformed.observe({});
    expect(validThenMalformed.evidence()).toEqual({ kind: 'malformed' }); expect(validThenMalformed.value()).toBeNull();
  });
  it('labels completed JSON missing usage separately from transport interruption', async () => {
    const observations = [];
    const boundary = createAccountedBoundary({ profile, prepare: async () => ({ finish: async (...args) => observations.push(args) }) });
    const ticket = await boundary.prepare({});
    await ticket.response(new Response('{}'));
    expect(observations[0][2]).toEqual({ kind: 'absent', interrupted: false });
    const broken = new ReadableStream({ start(controller) { controller.error(new Error('network')); } });
    const interrupted = await boundary.prepare({});
    await expect(interrupted.response(new Response(broken))).rejects.toThrow();
    expect(observations[1][2]).toEqual({ kind: 'absent', interrupted: true });
  });
  it('does not exempt an oversized JSON evidence body as absent', async () => {
    const { ACCOUNTING_JSON_MAX_BYTES } = await import('../../open-sse/config/runtimeConfig.js');
    const calls = [];
    const boundary = createAccountedBoundary({ profile, prepare: async () => ({ finish: async (...args) => calls.push(args) }) });
    const ticket = await boundary.prepare({});
    await expect(ticket.response(new Response(new Uint8Array(ACCOUNTING_JSON_MAX_BYTES + 1)))).rejects.toThrow(/limit/);
    expect(calls).toHaveLength(1); expect(calls[0][2]).toEqual({ kind: 'malformed', interrupted: true });
  });
  it('never downgrades terminal-write failure to absent usage', async () => {
    const calls = [], failure = new Error('terminal write failed');
    const boundary = createAccountedBoundary({ profile, prepare: async () => ({ finish: async (...args) => { calls.push(args); throw failure; } }) });
    const ticket = await boundary.prepare({});
    await expect(ticket.response(new Response(JSON.stringify({ usage: rawUsage() })))).rejects.toBe(failure);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ exact: true });
    expect(calls[0][2]).toMatchObject({ kind: 'valid', interrupted: false });
  });
  it('retains terminal-write failure on interrupted reads without a second finish', async () => {
    const calls = [], failure = new Error('terminal persistence unavailable');
    const boundary = createAccountedBoundary({ profile, prepare: async () => ({ finish: async (...args) => { calls.push(args); throw failure; } }) });
    const ticket = await boundary.prepare({});
    const body = new ReadableStream({ start(controller) { controller.error(new Error('transport')); } });
    await expect(ticket.response(new Response(body))).rejects.toBe(failure);
    expect(calls).toEqual([[null, 'body_unknown', { kind: 'absent', interrupted: true }]]);
  });
});
