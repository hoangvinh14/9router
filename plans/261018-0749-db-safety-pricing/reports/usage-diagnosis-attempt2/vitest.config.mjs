export default {
  root: '/tmp/9router-usage-diagnosis-r2-MXC1lx',
  test: { environment: 'node', include: ['usage-diagnosis.test.js'], maxWorkers: 1, fileParallelism: false },
  resolve: { alias: [
    { find: /^vitest$/, replacement: '/home/gmo/projects/9router/tests/node_modules/vitest/dist/index.js' },
    { find: /^open-sse\//, replacement: '/home/gmo/projects/9router/open-sse/' },
    { find: 'open-sse', replacement: '/home/gmo/projects/9router/open-sse' },
    { find: /^@\//, replacement: '/home/gmo/projects/9router/src/' },
  ] },
};
