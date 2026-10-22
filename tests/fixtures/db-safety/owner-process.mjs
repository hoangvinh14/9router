import { acquireWriterOwnership } from '../../../src/lib/db/writerOwnership.js';
const file = process.argv[2];
let owner;
try {
  owner = acquireWriterOwnership(file);
  process.send?.({ ready: true });
} catch (error) {
  process.send?.({ ready: false, error: error.message }, () => process.exit(2));
}
process.on('message', message => {
  if (message === 'close') { owner?.release(); process.exit(0); }
});
