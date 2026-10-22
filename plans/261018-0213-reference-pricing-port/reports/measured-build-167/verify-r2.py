"""Partitioned, complete frozen-input verification; no build or network."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
OLD = HERE.parent / 'pricing-staged-build-inputs.json'


def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, UnicodeError, ValueError):
        raise RuntimeError('Unreadable verification input') from None


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def main():
    stage = sys.argv[1]
    old = load(OLD)
    deps = Path(old['dependencies'])
    manifest = HERE.parent / 'pricing-dependency-staging/tree-hashes.json'
    if digest(manifest) != old['dependencyTreeManifestSha256']:
        raise RuntimeError('Dependency manifest changed')
    tree = load(manifest)
    if stage == 'source':
        entries = list(old['files'].items()) + list(old['helper'].items())
        for index, (name, expected) in enumerate(entries):
            if digest(REPO / name) != expected:
                raise RuntimeError('Frozen source mismatch: ' + name)
            if index % 250 == 0:
                print('source', index, flush=True)
        if (deps/'package.json').read_bytes() != (REPO/'package.json').read_bytes():
            raise RuntimeError('Dependency package differs')
        if digest(deps/'package-lock.json') != old['stagingLockSha256']:
            raise RuntimeError('Staging lock differs')
        if digest(HERE.parent/'pricing-staged-build-attempt1/isolated-build-staging.py') != next(iter(old['helper'].values())):
            raise RuntimeError('Archived helper differs')
    elif stage == 'inventory':
        owner = deps.parent.lstat()
        if deps.parent.is_symlink() or owner.st_uid != os.getuid() or owner.st_mode & 0o077:
            raise RuntimeError('Unsafe dependency staging owner')
        files, links = set(), {}
        pending = [deps/'node_modules']
        directories = 0
        while pending:
            directory = pending.pop()
            with os.scandir(directory) as children:
                for entry in children:
                    path = Path(entry.path)
                    key = str(path.relative_to(deps))
                    if entry.is_symlink():
                        links[key] = os.readlink(path)
                        if not path.resolve(strict=True).is_relative_to(deps.resolve()):
                            raise RuntimeError('Escaping dependency link')
                    elif entry.is_dir(follow_symlinks=False):
                        pending.append(path)
                    elif entry.is_file(follow_symlinks=False):
                        files.add(key)
                    else:
                        raise RuntimeError('Unsupported dependency entry')
            directories += 1
            if directories % 500 == 0:
                print('inventory', directories, len(files), len(links), flush=True)
        if files != set(tree['files']) or links != tree['links']:
            raise RuntimeError('Staging inventory differs')
    elif stage.startswith('hash-'):
        chunk = int(stage.split('-')[1])
        entries = sorted(tree['files'].items())[chunk*3000:(chunk+1)*3000]
        if not entries:
            raise RuntimeError('Empty hash partition')
        for index, (name, expected) in enumerate(entries):
            if digest(deps/name) != expected:
                raise RuntimeError('Dependency hash differs: ' + name)
            if index % 500 == 0:
                print(stage, index, flush=True)
    else:
        raise RuntimeError('Unknown verification stage')
    receipt = {'stage':stage, 'pass':True, 'time':time.time(), 'oldManifest':digest(OLD),
               'treeManifest':digest(manifest), 'verifierHash':digest(Path(__file__))}
    if stage == 'source':
        receipt['rootLockSha256'] = digest(REPO/'package-lock.json')
    (HERE/('verify-'+stage+'.json')).write_text(json.dumps(receipt, indent=2))
    print(stage, 'PASS', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print('VERIFY FAILED', type(error).__name__, str(error)[:150], flush=True)
        sys.exit(1)
