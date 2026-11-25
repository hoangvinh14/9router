import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sqlJsWriterPath } from './nodeClosure.js';

function linuxIdentity() {
  if (process.platform !== 'linux') return null;
  try {
    return {
      boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      namespace: fs.readlinkSync('/proc/self/ns/pid'),
    };
  } catch { return null; }
}

function readOwner(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) throw new Error('Invalid SQL.js writer record');
  const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
      typeof owner.token !== 'string' || typeof owner.file !== 'string') throw new Error('Invalid SQL.js writer record');
  return owner;
}

function ownerExited(owner, self) {
  if (!self.linux || owner.linux?.boot !== self.linux.boot || owner.linux.namespace !== self.linux.namespace ||
      owner.file !== self.file) return false;
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code === 'ESRCH'; }
  return false;
}

export function acquireSqlJsWriter(filePath) {
  const directory = fs.realpathSync(path.dirname(path.resolve(filePath)));
  const file = path.join(directory, path.basename(filePath));
  const lock = sqlJsWriterPath(file);
  const gate = lock + '.guard';
  const self = { pid: process.pid, file, token: randomUUID(), linux: linuxIdentity() };
  let released = false;
  const arbitrate = action => {
    fs.mkdirSync(gate, { mode: 0o700 });
    try { return action(); }
    finally { fs.rmdirSync(gate); }
  };
  arbitrate(() => {
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (stat && (!stat.isFile() || stat.nlink !== 1)) throw new Error('SQL.js requires a regular single-link database file');
    if (fs.lstatSync(lock, { throwIfNoEntry: false })) {
      if (!ownerExited(readOwner(lock), self)) throw new Error('SQL.js database writer already active or ownership is ambiguous');
      fs.unlinkSync(lock);
    }
    const fd = fs.openSync(lock, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(self)); }
    finally { fs.closeSync(fd); }
  });
  function assertOwned() {
    if (released || fs.realpathSync(directory) !== directory || readOwner(lock).token !== self.token) {
      throw new Error('SQL.js database writer ownership lost');
    }
  }
  return {
    file,
    assertOwned,
    release() {
      if (released) return;
      arbitrate(() => {
        assertOwned();
        fs.unlinkSync(lock);
        released = true;
      });
    },
  };
}
