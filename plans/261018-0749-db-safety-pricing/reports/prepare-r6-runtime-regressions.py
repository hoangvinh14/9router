import hashlib
import json
import os
import pathlib
import shutil

REPO = pathlib.Path('/home/gmo/projects/9router')
REPORTS = REPO / 'plans/261018-0749-db-safety-pricing/reports'
LANES = [
    ('better', pathlib.Path('/tmp/9router-db-safety-better-r4-RntrCG'), pathlib.Path('/tmp/9router-db-better-r6-jOZC9C'), 'abi127-adapter-harness.mjs'),
    ('bun', pathlib.Path('/tmp/9router-db-safety-bun-ordinary-r4-pFyDh4'), pathlib.Path('/tmp/9router-db-bun-r6-AZAROO'), 'bun-ordinary-harness.mjs'),
]

def need(ok, message):
    if not ok:
        raise RuntimeError(message)

def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

EXTRA_CASES = """    await check('dangling DB symlink refuses open and leaves target absent', async () => {
      const directory = path.join(process.env.DATA_DIR, 'dangling');
      const targetDir = path.join(process.env.DATA_DIR, 'dangling-target');
      fs.mkdirSync(directory); fs.mkdirSync(targetDir);
      const link = path.join(directory, 'data.sqlite'), target = path.join(targetDir, 'data.sqlite');
      fs.symlinkSync(target, link);
      await assert.rejects(async () => await create(link), /regular/);
      assert.equal(fs.existsSync(target), false);
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
      assert.equal(fs.existsSync(path.join(directory, '.gateway-writer.lock')), false);
    });
    await check('closed engine retries lease release after gate collision then reopens', async () => {
      const target = path.join(process.env.DATA_DIR, 'release-retry/data.sqlite');
      const retryDb = track(await create(target));
      retryDb.durableTransaction(() => retryDb.exec('CREATE TABLE release_fixture(id INTEGER)'));
      const gate = path.join(path.dirname(target), '.gateway-writer-acquisition'); fs.mkdirSync(gate);
      try {
        assert.throws(() => retryDb.close(), /acquisition/);
        assert.throws(() => retryDb.close(), /acquisition/);
        assert.equal(retryDb.health().closed, true);
        assert.equal(retryDb.health().healthy, false);
        assert.equal(retryDb.health().owned, true);
      } finally { fs.rmdirSync(gate); }
      close(retryDb); retryDb.close();
      assert.equal(fs.existsSync(path.join(path.dirname(target), '.gateway-writer.lock')), false);
      const replacement = track(await create(target));
      assert.equal(replacement.get('SELECT COUNT(*) AS n FROM release_fixture').n, 0);
      close(replacement);
    });
"""

def main():
    source_manifest = REPORTS / 'candidate-r6-source.json'
    frozen = json.loads(source_manifest.read_text())['files']
    for name, digest in frozen.items():
        need(sha(REPO / name) == digest, 'R6 source drift: ' + name)
    for lane, old, root, harness_name in LANES:
        need(root.resolve(strict=True).parent == pathlib.Path('/tmp'), 'Invalid root')
        need(root.stat().st_uid == os.getuid() and root.stat().st_mode & 0o077 == 0, 'Unsafe root mode/owner')
        need(not list(root.iterdir()), 'Root not empty')
        old_inputs = json.loads((old / 'evidence/mirror-inputs.json').read_text())
        for name, digest in old_inputs['files'].items():
            need(sha(old / 'mirror' / name) == digest, 'Old mirror drift: ' + name)
        shutil.copytree(old / 'mirror', root / 'mirror')
        for src in (REPO / 'src/lib/db').rglob('*.js'):
            dest = root / 'mirror' / src.relative_to(REPO)
            need(dest.is_file() and not src.is_symlink(), 'Unexpected source shape: ' + str(src))
            shutil.copyfile(src, dest)
        shutil.copytree(old / 'harness', root / 'harness')
        for file in (root / 'harness').iterdir():
            if file.suffix in ('.mjs', '.cjs'):
                text = file.read_text().replace(str(old), str(root))
                if file.name == harness_name:
                    marker = '    assert.equal(result.cases.length, 12);'
                    need(text.count(marker) == 1, 'Harness scenario marker mismatch')
                    text = text.replace(marker, EXTRA_CASES + '    assert.equal(result.cases.length, 14);')
                file.write_text(text)
        if lane == 'bun':
            (root / 'bin').mkdir()
            binary = old / 'bin/bun'
            need(sha(binary) == '7ce7d6b654eddeec20afddf2396317fba6dc19ab52788a27e894e1806bf8f24b', 'Bun binary drift')
            shutil.copyfile(binary, root / 'bin/bun'); (root / 'bin/bun').chmod(0o700)
        else:
            addon = root / 'mirror/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
            need(sha(addon) == 'df9fbd0d061f360d81fb51e265c53c9605020bd68219e34f33c07c85de15719a', 'Private addon drift')
        for directory in ['evidence', 'fixtures', 'fixtures/home', 'fixtures/data', 'fixtures/tmp', 'fixtures/cache']:
            (root / directory).mkdir(mode=0o700)
        files = {str(f.relative_to(root / 'mirror')): sha(f) for f in (root / 'mirror').rglob('*') if f.is_file()}
        helpers = {f.name: sha(f) for f in (root / 'harness').iterdir() if f.is_file()}
        for name in files:
            if name.startswith('src/'):
                need(sha(REPO / name) == files[name], 'Current mirror mismatch: ' + name)
        (root / 'evidence/mirror-inputs.json').write_text(json.dumps({
            'lane': lane, 'root': str(root), 'files': files, 'harnessSha256': helpers,
            'sourceManifestSha256': sha(source_manifest), 'frozenSource': frozen,
            'change': 'R6 byte-identical DB source; retained12main+2child controls plus dangling-path and release-retry controls; no signal flow',
            'timeoutSeconds': 60, 'childTimeoutMs': 10000,
        }, indent=2))
        print(lane, root, len(files), 'mirror files;14main+2childcontrols prepared')

if __name__ == '__main__':
    main()
