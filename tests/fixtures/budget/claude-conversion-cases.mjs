import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClaudeToolStore } from '../../../src/lib/accounting/claude-tool-continuity.js';
import { createNodeKeyPolicy } from '../../../src/lib/accounting/node-key-policy.js';

export function exerciseClaudeConversion({ test, fixture, postResponses, workspaceBinding, usage, sseFrame, sseReply }) {
  test('Claude continuity bounds retained turns and rejects ambiguous upstream IDs', () => {
    const store = createClaudeToolStore({ maxTurns: 1 });
    const scope = ['key','anthropic','model','connection'];
    const make = id => ({ type: 'tool_use', id, name: 'read', input: {} });
    const restore = (id, scopeOverride = scope) => store.restore(scopeOverride, [{ id, name: 'read', input: {} }]);
    store.save(scope, [make('first')]);
    for (let i = 0; i < scope.length; i++) assert.throws(() => restore('first', scope.map((x,j) => i === j ? x + '2' : x)));
    assert.deepEqual(restore('first'), [make('first')]);
    store.save(scope, [make('second')]);
    assert.throws(() => restore('first'));
    assert.throws(() => store.save(scope, [make('second')]));
    assert.throws(() => restore('second'));
    assert.throws(() => store.save(scope, [make('third'),make('third')]));
    assert.throws(() => restore('third'));
  });
  for (const provider of ['claude', 'anthropic']) for (const endpoint of ['/v1/chat/completions', '/v1/responses']) for (const stream of [false, true]) {
    test(provider + ' two-turn continuation via ' + endpoint + ' stream=' + stream, async t => {
      const responses = endpoint === '/v1/responses';
      const suffix = provider + (responses ? 'resp' : 'chat') + Number(stream);
      const blocks = [
        { type: 'thinking', thinking: 'tool reasoning', signature: 'signature-' + suffix },
        { type: 'redacted_thinking', data: 'opaque-' + suffix },
        ...['left','right'].map((name,i) => ({ type: 'tool_use', id: 'toolu_' + name + suffix, name, input: { n: i } })),
      ];
      const target = 'claude-haiku-4-5';
      const revision = 'anthropic:claude/claude-haiku-4-5:standard:v1';
      function frames(content) {
        return [{ type: 'message_start', message: { id: 'msg_fixture', model: target, content: [], usage } },
          ...content.flatMap((b,index) => [{ type: 'content_block_start', index, content_block: b }, { type: 'content_block_stop', index }]),
          { type: 'message_delta', delta: { stop_reason: content.length > 1 ? 'tool_use' : 'end_turn' }, usage: { output_tokens: usage.output_tokens } },
          { type: 'message_stop' }].map(sseFrame);
      }
      let turn = 0;
        await fixture(async ({ state, rows, totals, path, setMonthly, inspectPolicy }) => {
          const model = provider + '/' + target;
          const history = [{ role: 'user', content: 'check tools' }];
          const send = (input, secret = 'fixture-client') => postResponses(new Request('https://fixture.invalid' + endpoint, {
            method: 'POST', headers: { authorization: 'Bearer ' + secret },
            body: JSON.stringify({ model, stream, [responses ? 'input' : 'messages']: input,
              ...(responses ? { reasoning: { effort: 'high', summary: 'auto' } } : { reasoning_effort: 'high' }),
              tools: ['left','right'].map(name => responses ? { type: 'function', name, parameters: { type: 'object' } } :
                { type: 'function', function: { name, parameters: { type: 'object' } } }) }),
          }));
          const first = await send(history);
          const raw = await first.text();
          assert.equal(first.status, 200, raw);
          assert.ok(!raw.includes('signature-') && !raw.includes('opaque-'));
          const data = stream ? raw.split('\n').filter(l => l.startsWith('data: {')).map(l => JSON.parse(l.slice(6))) : JSON.parse(raw);
          let followup;
          if (responses) {
            const output = stream ? data.at(-1).response.output : data.output;
            const results = output.filter(i => i.type === 'function_call').map(i => ({ type: 'function_call_output', call_id: i.call_id, output: 'result' }));
            followup = [...history, ...output, ...results];
          } else {
            const streamedCalls = [];
            if (stream) for (const c of data) for (const t of c.choices[0]?.delta.tool_calls ?? []) {
              if (t.id) streamedCalls[t.index] = { id: t.id, type: t.type, function: { name: t.function.name, arguments: '' } };
              streamedCalls[t.index].function.arguments += t.function.arguments;
            }
            const message = stream ? { role: 'assistant', content: null, tool_calls: streamedCalls } : data.choices[0].message;
            followup = [...history, message, ...message.tool_calls.map(t => ({ role: 'tool', tool_call_id: t.id, content: 'result' }))];
          }
          followup.at(-1).is_error = true;
          assert.equal(rows().terminals.length, 1);
          assert.equal((await send(followup.slice(0,-1))).status, 503);
          const duplicate = structuredClone(followup);
          duplicate[duplicate.length - 1] = duplicate.at(-2);
          assert.equal((await send(duplicate)).status, 503);
          assert.equal(state.wire.length, 1);
          const different = structuredClone(followup);
          if (responses) different.at(-1).call_id = 'no-such-id';
          else different.at(-1).tool_call_id = 'no-such-id';
          assert.equal((await send(different)).status, 503);
          const errorResult = structuredClone(followup);
          errorResult.at(-1).is_error = 'true';
          assert.equal((await send(errorResult)).status, 503);
          // The second key routes to the same upstream account.
          state.db.run('INSERT INTO apiKeys VALUES (?,?,?,?,?)', ['fixture-key-b', 'fixture-client-b', 1, 1, JSON.stringify([model])]);
          createNodeKeyPolicy(state.db).save('fixture-key-b', 0, { weekly: null, monthly: '70600' });
          assert.equal((await send(followup, 'fixture-client-b')).status, 503);
          if (provider === 'anthropic') {
            const alternate = { ...workspaceBinding, connectionId: 'fixture-other',
              keyDigest: createHash('sha256').update('fixture-other-key').digest('hex') };
            state.db.run('INSERT INTO kv VALUES (?, ?, ?)', ['accounting.anthropic.workspace.v1', alternate.connectionId, JSON.stringify(alternate)]);
            state.db.run("UPDATE providerConnections SET isActive = 0 WHERE id = 'fixture-account'");
            assert.equal((await send(followup)).status, 503);
            state.db.run("UPDATE providerConnections SET isActive = 1 WHERE id = 'fixture-account'");
          }
          assert.equal(state.wire.length, 1);
          if (provider === 'anthropic' && !stream && responses) {
            const fresh = spawnSync(process.execPath, ['--experimental-loader', '/app/tests/fixtures/budget/composed-loader.mjs',
              '/app/tests/fixtures/budget/claude-conversion-restart.mjs'], { encoding: 'utf8', timeout: 6000, env: process.env,
              input: JSON.stringify({ path, endpoint, model, input: followup }) });
            assert.ifError(fresh.error);
            assert.equal(fresh.status, 0, fresh.stderr);
          }
          const second = await send(followup);
          const final = await second.text();
          assert.equal(second.status, 200, final);
          assert.match(final, /all done/);
          assert.deepEqual(state.wire[0].body.thinking, { type: 'adaptive', display: 'summarized' });
          assert.deepEqual(state.wire[0].body.output_config, { effort: 'high' });
          assert.deepEqual(state.wire[1].body.messages[1].content, blocks);
          assert.deepEqual(state.wire[1].body.messages[2].content, blocks.slice(-2).map((b,i) => ({ type: 'tool_result', content: 'result', tool_use_id: b.id, ...(i ? { is_error: true } : {}) })));
          assert.deepEqual(rows().terminals.map(t => t.amount), ['35300','35300']);
          assert.equal(totals().monthly, '70600');
          assert.equal((await send(history)).status, 503);
          assert.equal(state.wire.length, 2);
          // Raise the budget again so an expired binding must fail before preparation.
          setMonthly(inspectPolicy().version, '1000000');
          t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 31 * 60000 });
          try {
            const prepared = state.preparations;
            assert.equal((await send(followup)).status, 503);
            assert.equal(state.preparations, prepared);
            assert.equal(state.wire.length, 2);
          } finally { t.mock.timers.reset(); }
          if (provider === 'anthropic' && !stream && responses) {
            // The conversion fails while the native meter can still settle
            // the complete provider usage which follows the unsupported block.
            const malformed = await send(history);
            assert.equal(malformed.status, 502);
            assert.equal(state.wire.length, 3);
            assert.deepEqual(rows().terminals.map(t => t.amount), ['35300','35300','35300']);
          }
        }, { monthly: '70600', profile: { provider }, reply: () => {
          const content = [blocks, [{ type: 'text', text: 'all done' }], [{ type: 'unsupported' }]][turn++];
          return sseReply(frames(content))();
        }, prepareDb(db) {
          db.run('UPDATE apiKeys SET accessAllow = ? WHERE id = ?', [JSON.stringify([provider + '/' + target]), 'fixture-key']);
          if (provider === 'claude') db.run("INSERT INTO providerConnections(id,provider,authType,isActive,data,createdAt,updatedAt) VALUES ('fixture-claude','claude','oauth',1,?,?,?)",
            [JSON.stringify({ accessToken: 'fixture-token' }), '2026-11-16T10:00:00Z','2026-11-16T10:00:00Z']);
          db.run('INSERT INTO kv VALUES (?,?,?)', ['budgetReferencePricing', revision, JSON.stringify({
            currency: 'USD', unit: 'USD/1M tokens', revision, syncedAt: 2, source: 'https://platform.claude.com/docs/en/about-claude/pricing.md',
            rates: { input: '1', cached: '0.10', cache_creation: '1.25', cache_creation_1h: '2', output: '5' },
          })]);
        } });
    });
  }
}
