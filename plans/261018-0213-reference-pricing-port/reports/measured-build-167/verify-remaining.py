"""Complete dependency hash coverage in deterministic 500-file partitions."""
import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPORT = HERE.parent
OLD_PATH = REPORT / 'pricing-staged-build-inputs.json'
TREE_PATH = REPORT / 'pricing-dependency-staging/tree-hashes.json'
START = 21000
WIDTH = 500


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, UnicodeError, ValueError):
        raise RuntimeError('Invalid verification input') from None


def main():
    if len(sys.argv) != 2:
        raise RuntimeError('partition index required')
    partition = int(sys.argv[1])
    old = load(OLD_PATH)
    deps = Path(old['dependencies'])
    tree = load(TREE_PATH)
    entries = sorted(tree['files'].items())
    begin = START + partition * WIDTH
    end = min(begin + WIDTH, len(entries))
    if begin >= len(entries):
        raise RuntimeError('partition out of range')
    for offset, (name, expected) in enumerate(entries[begin:end]):
        if digest(deps / name) != expected:
            raise RuntimeError('dependency hash mismatch: ' + name)
        if offset % 100 == 0:
            print('partition', partition, 'progress', offset, flush=True)
    receipt = {
        'partition': partition,
        'begin': begin,
        'end': end,
        'count': end - begin,
        'pass': True,
        'checkedAt': time.time(),
        'oldManifestSha256': digest(OLD_PATH),
        'treeManifestSha256': digest(TREE_PATH),
        'dependencyLockSha256': digest(deps / 'package-lock.json'),
        'stagingLockExpected': old['stagingLockSha256'],
    }
    out = HERE / f'verify-remaining-{partition:04d}.json'
    out.write_text(json.dumps(receipt, indent=2))
    print('partition', partition, 'PASS', begin, end, flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError) as error:
        print('PARTITION FAILED', type(error).__name__, str(error)[:180], flush=True)
        sys.exit(1)
