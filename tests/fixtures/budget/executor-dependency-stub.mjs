// Module resolution target ONLY for Node's explicit module mocks in executor
// branch test. If mocks do not intercept, fail rather than load application jobs.
throw new Error('Executor dependency mock not installed');
