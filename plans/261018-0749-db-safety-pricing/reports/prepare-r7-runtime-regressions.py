import hashlib
import json
import os
import pathlib
import shutil
import stat

REPO = pathlib.Path('/home/gmo/projects/9router')
REPORTS = REPO / 'plans/261018-0749-db-safety-pricing/reports'
LANES = [
    # Recorded mkdtemp-created private fixtures; validated below, never allocated predictably.
    ('better', pathlib.Path('/tmp/9router-db-better-r6-jOZC9C'), pathlib.Path('/tmp/9router-db-better-r7-WrK9QV'), 'abi127-adapter-harness.mjs'),  # noqa: S108  # nosec B108
    ('bun', pathlib.Path('/tmp/9router-db-bun-r6-AZAROO'), pathlib.Path('/tmp/9router-db-bun-r7-m13fAK'), 'bun-ordinary-harness.mjs'),  # noqa: S108  # nosec B108
]

def need(ok, message):
    if not ok:
        raise RuntimeError(message)

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

EXTRA = """    for (const phase of ['after-unlink', 'after-gate-cleanup']) {
      await check(`actual engine closed release sync recovery ${phase} preserves replacement`, async () => {
        const target = path.join(process.env.DATA_DIR, 'sync-' + phase, 'data.sqlite');
        const directory = path.dirname(target), lock = path.join(directory, '.gateway-writer.lock');
        const gate = path.join(directory, '.gateway-writer-acquisition');
        const oldDb = track(await create(target));
        oldDb.durableTransaction(() => oldDb.exec('CREATE TABLE sync_fixture(id INTEGER)'));
        const originals = { open: fs.openSync, close: fs.closeSync, sync: fs.fsyncSync, unlink: fs.unlinkSync, mkdir: fs.mkdirSync, rmdir: fs.rmdirSync };
        const directoryFds = new Set();
        let removed = false, gateRemoved = false, enabled = true, syncs = 0, failures = 0, unlinks = 0;
        try {
          fs.openSync = function(name, ...args) { const fd = originals.open(name, ...args); if (name === directory) directoryFds.add(fd); return fd; };
          fs.closeSync = function(fd) { directoryFds.delete(fd); return originals.close(fd); };
          fs.mkdirSync = function(name, ...args) { const value = originals.mkdir(name, ...args); if (name === gate) gateRemoved = false; return value; };
          fs.unlinkSync = function(name, ...args) { const value = originals.unlink(name, ...args); if (name === lock) { removed = true; unlinks++; } return value; };
          fs.rmdirSync = function(name, ...args) { const value = originals.rmdir(name, ...args); if (name === gate) gateRemoved = true; return value; };
          fs.fsyncSync = function(fd) {
            if (directoryFds.has(fd) && removed) {
              syncs++;
              if (enabled && (phase === 'after-unlink' ? !gateRemoved : gateRemoved)) { failures++; throw new Error('fixture directory sync failure'); }
            }
            return originals.sync(fd);
          };
          assert.throws(() => oldDb.close(), /fixture directory sync failure/);
          assert.throws(() => oldDb.close(), /fixture directory sync failure/);
          assert.equal(failures, 2); assert.equal(unlinks, 1);
          assert.equal(oldDb.health().closed, true); assert.equal(oldDb.health().healthy, false);
          assert.throws(() => oldDb.get('SELECT 1'));
          enabled = false;
          const replacement = track(await create(target));
          const bytes = fs.readFileSync(lock);
          const before = syncs;
          close(oldDb);
          assert.equal(syncs - before, 2);
          assert.equal(unlinks, 1);
          assert.equal(fs.readFileSync(lock).equals(bytes), true);
          assert.equal(replacement.get('SELECT COUNT(*) AS n FROM sync_fixture').n, 0);
          const complete = syncs; oldDb.close(); assert.equal(syncs, complete);
          close(replacement);
        } finally {
          fs.openSync = originals.open; fs.closeSync = originals.close; fs.fsyncSync = originals.sync;
          fs.unlinkSync = originals.unlink; fs.mkdirSync = originals.mkdir; fs.rmdirSync = originals.rmdir;
        }
      });
    }
"""

def main():
    manifest = REPORTS / 'candidate-r7-source.json'
    try:
        frozen = json.loads(manifest.read_text())['files']
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError('Cannot read R7 source manifest') from exc
    for name, digest in frozen.items():
        need(sha(REPO / name) == digest, 'R7 source drift: ' + name)
    for lane, old, root, harness_name in LANES:
        # Validates an existing mkdtemp-created private root, not a predictable allocation.
        temporary_parent = pathlib.Path('/tmp')  # noqa: S108  # nosec B108
        root_stat = root.lstat()
        need(stat.S_ISDIR(root_stat.st_mode) and not root.is_symlink(), 'Root must be a real directory')
        need(root.resolve(strict=True).parent == temporary_parent and root_stat.st_uid == os.getuid()
             and stat.S_IMODE(root_stat.st_mode) == 0o700, 'Unsafe root')
        old_stat = old.lstat()
        need(stat.S_ISDIR(old_stat.st_mode) and not old.is_symlink() and old_stat.st_uid == os.getuid()
             and stat.S_IMODE(old_stat.st_mode) == 0o700 and old.resolve(strict=True).parent == temporary_parent,
             'Unsafe prior fixture')
        need(not list(root.iterdir()), 'Root not empty')
        try:
            previous = json.loads((old / 'evidence/mirror-inputs.json').read_text())
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError('Cannot read prior mirror inputs: ' + str(old)) from exc
        for name, digest in previous['files'].items():
            need(sha(old / 'mirror' / name) == digest, 'Old mirror drift: ' + name)
        for name, digest in previous['harnessSha256'].items():
            need(sha(old / 'harness' / name) == digest, 'Old helper drift: ' + name)
        shutil.copytree(old / 'mirror', root / 'mirror')
        for src in (REPO / 'src/lib/db').rglob('*.js'):
            dest = root / 'mirror' / src.relative_to(REPO)
            need(dest.is_file() and not src.is_symlink(), 'Source shape mismatch')
            shutil.copyfile(src, dest)
        shutil.copytree(old / 'harness', root / 'harness')
        for file in (root / 'harness').iterdir():
            if file.suffix in ('.mjs', '.cjs'):
                text = file.read_text().replace(str(old), str(root))
                if file.name == harness_name:
                    marker = '    assert.equal(result.cases.length, 14);'
                    need(text.count(marker) == 1, 'Scenario marker mismatch')
                    text = text.replace(marker, EXTRA + '    assert.equal(result.cases.length, 16);')
                file.write_text(text)
        if lane == 'bun':
            need(sha(old / 'bin/bun') == '7ce7d6b654eddeec20afddf2396317fba6dc19ab52788a27e894e1806bf8f24b', 'Bun drift')
            (root / 'bin').mkdir()
            shutil.copyfile(old / 'bin/bun', root / 'bin/bun')
            (root / 'bin/bun').chmod(0o700)
        else:
            need(sha(root / 'mirror/node_modules/better-sqlite3/build/Release/better_sqlite3.node') == 'df9fbd0d061f360d81fb51e265c53c9605020bd68219e34f33c07c85de15719a', 'Addon drift')
        for directory in ['evidence', 'fixtures', 'fixtures/home', 'fixtures/data', 'fixtures/tmp', 'fixtures/cache']:
            (root / directory).mkdir(mode=0o700)
        files = {str(f.relative_to(root / 'mirror')): sha(f) for f in (root / 'mirror').rglob('*') if f.is_file()}
        for name, digest in files.items():
            if name.startswith('src/'):
                need(sha(REPO / name) == digest, 'Current mirror mismatch: ' + name)
        (root / 'evidence/mirror-inputs.json').write_text(json.dumps({
            'lane': lane, 'root': str(root), 'files': files,
            'harnessSha256': {f.name: sha(f) for f in (root / 'harness').iterdir() if f.is_file()},
            'sourceManifestSha256': sha(manifest), 'frozenSource': frozen,
            'change': 'retained R6 controls plus 2 explicit JS-fault actual-engine directorysync controls; no signal flow',
            'timeoutSeconds': 60, 'childTimeoutMs': 10000,
        }, indent=2))
        print(lane, root, '16main+2childcontrols prepared')

if __name__ == '__main__':
    main()
