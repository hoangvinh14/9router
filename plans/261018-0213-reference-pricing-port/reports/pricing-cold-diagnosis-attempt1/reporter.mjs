import fs from 'node:fs';
const file = new URL('./runner-events.jsonl', import.meta.url);
function emit(value) { fs.appendFileSync(file, JSON.stringify(value) + '\n'); }
export default class DiagnosticReporter {
  onInit(ctx) { emit({ event: 'config', testTimeout: ctx.config.testTimeout, hookTimeout: ctx.config.hookTimeout }); }
  onTestCaseResult(test) {
    const result = test.result();
    emit({ event: 'result', name: test.fullName, options: test.options, state: result.state,
      errors: result.errors?.map(error => ({ name: error.name, message: error.message, stack: error.stack })), diagnostic: test.diagnostic() });
  }
}
