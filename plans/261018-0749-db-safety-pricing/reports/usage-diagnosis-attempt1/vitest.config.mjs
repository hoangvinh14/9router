export default {
  root: '/tmp/9router-usage-diagnosis-qx2rXF',
  test: { environment: 'node', include: ['usage-diagnosis.test.js'], maxWorkers: 1, fileParallelism: false },
  resolve: { alias: [
    { find: /^open-sse\//, replacement: '/home/gmo/projects/9router/open-sse/' },
    { find: 'open-sse', replacement: '/home/gmo/projects/9router/open-sse' },
    { find: /^@\//, replacement: '/home/gmo/projects/9router/src/' },
  ] },
};
