import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export function assertAccountingIsolation() {
  const root=process.env.R1_ISOLATED_ROOT;
  if (!root || !path.isAbsolute(root) || fs.realpathSync(root)!==root || process.env.HOME!==`${root}/home` ||
      process.env.DATA_DIR!==`${root}/data` || process.env.TMPDIR!==`${root}/tmp`) throw new Error('Disposable pre-import roots required');
  if(fs.readlinkSync('/proc/self/ns/net')===process.env.R1_OUTER_NET)throw new Error('Private network namespace required');
  if(fs.readFileSync('/isolation-canary','utf8')!=='sacrificial-read-only')throw new Error('Missing sacrificial mount proof');
  let denied=false;
  try{fs.writeFileSync('/isolation-canary','escape');}catch(error){denied=['EROFS','EACCES','EPERM'].includes(error.code);}
  if(!denied)throw new Error('Outside-root write was not refused');
  try{fs.readFileSync(process.env.R1_HIDDEN_CANARY);throw new Error('Host sacrificial secret visible');}
  catch(error){if(!['ENOENT','EACCES','EPERM'].includes(error.code))throw error;}
  // Positive control prevents unavailable/broken SQLite from passing denial.
  const probe=path.join(root,'tmp',`sqlite-attestation-${process.pid}.sqlite`);
  const positive=new DatabaseSync(probe);positive.exec('CREATE TABLE IF NOT EXISTS probe(n)');positive.close();fs.unlinkSync(probe);
  let sqliteDenied=false;
  try{const db=new DatabaseSync('/read-only-fixture/outside-root.sqlite');db.close();}
  catch(error){sqliteDenied=error.code==='ERR_SQLITE_ERROR' && error.errcode===14;}
  if(!sqliteDenied)throw new Error('Expected SQLite CANTOPEN outside disposable root');
  return root;
}
