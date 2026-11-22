"""Metadata only: fixed prior package/browser closure, no browser execution.
Streaming/per-file progress diagnoses prior buffered whole-file scan timeouts.
"""
import hashlib
import json
import os
import stat
import time
from pathlib import Path

repo = Path(__file__).resolve().parents[3]
start = time.monotonic()

def log(*values):
    print(f'{time.monotonic()-start:.3f}s', *values, flush=True)

def validate_path(path):
    for ancestor in [path, *path.parents]:
        if stat.S_ISLNK(ancestor.lstat().st_mode):
            raise RuntimeError(f'Symlink input: {ancestor}')


def walk_error(error):
    raise error


def inventory(root):
    # Validate ancestors and every entry, including directory/dangling symlinks.
    validate_path(root)
    if not stat.S_ISDIR(root.lstat().st_mode):
        raise RuntimeError('Inventory root is not a directory')
    entries = []
    log('walk-start', root)
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            mode = path.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
                raise RuntimeError(f'Nonregular input: {path}')
            if stat.S_ISREG(mode):
                entries.append(path)
    log('walk-end', root, 'files', len(entries))
    rows = []
    for path in sorted(entries):
        before = path.stat()
        log('file-start', path.relative_to(root), 'bytes', before.st_size)
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        after = path.stat()
        if (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns):
            raise RuntimeError('Input changed during hash')
        rows.append(f'{path.relative_to(root)} {digest.hexdigest()}')
        log('file-end', path.relative_to(root), digest.hexdigest())
    log('tree-complete', root, len(rows), hashlib.sha256('\n'.join(rows).encode()).hexdigest())

for name in ['react', 'react-dom', 'scheduler', 'prop-types', 'playwright-core', 'typescript']:
    package = repo / 'node_modules' / name
    metadata = package / 'package.json'
    validate_path(metadata)
    if not stat.S_ISREG(metadata.lstat().st_mode):
        raise RuntimeError('Package metadata is not regular')
    log('version', name, json.loads(metadata.read_text())['version'])
    if name == 'playwright-core':
        inventory(package)
inventory(Path('/home/gmo/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64'))
log('inventory-complete')
