"""Bounded input verification and observer controls; no install/build here."""
import hashlib
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, cast

REPORT = Path(__file__).resolve().parent
REPO = REPORT.parents[3]
DEPENDENCIES = Path(tempfile.gettempdir()) / '9router-pricing-dependencies-9rqe5d7_' / 'stage'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def decode_json(text):
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        raise RuntimeError('Invalid diagnostic JSON input') from None

def load_json(path):
    try:
        return decode_json(path.read_text())
    except (OSError, UnicodeError):
        raise RuntimeError('Diagnostic JSON input unavailable') from None

def main():
    old = load_json(REPORT.parent / 'pricing-staged-build-inputs.json')
    sources = old['files'] if 'files' in old else old.get('sourceHashes')
    if sources is None:
        # Refuse guessing an input field: print only names, never private values.
        raise RuntimeError('Unknown source manifest keys: ' + ','.join(old.keys()))
    tree_path = REPORT.parent / 'pricing-dependency-staging/tree-hashes.json'
    verifier_hash = digest(REPORT/'verify-r2.py')
    old_hash = digest(REPORT.parent/'pricing-staged-build-inputs.json')
    stages = ['source', 'inventory'] + ['hash-' + str(n) for n in range(13)]
    for stage in stages:
        receipt = load_json(REPORT/('verify-'+stage+'.json'))
        if not receipt.get('pass') or receipt.get('stage') != stage or receipt.get('verifierHash') != verifier_hash or receipt.get('oldManifest') != old_hash or receipt.get('treeManifest') != old['dependencyTreeManifestSha256']:
            raise RuntimeError('Invalid partition receipt: ' + stage)
        if not 0 <= time.time() - receipt['time'] < 600:
            raise RuntimeError('Stale partition receipt')
    # Recheck the small source set at the handoff; dependency partition coverage
    # is complete, bound to one frozen manifest, and read-only inside the build.
    for name, expected in sources.items():
        if digest(REPO/name) != expected:
            raise RuntimeError('Source changed before preflight')
    if (DEPENDENCIES / 'package.json').read_bytes() != (REPO / 'package.json').read_bytes():
        raise RuntimeError('Staging package mismatch')
    if digest(DEPENDENCIES / 'package-lock.json') != old['stagingLockSha256']:
        raise RuntimeError('Staging lock mismatch')
    if digest(tree_path) != old['dependencyTreeManifestSha256']:
        raise RuntimeError('Frozen dependency manifest mismatch')
    for name, expected in old['helper'].items():
        if digest(REPO / name) != expected:
            raise RuntimeError('Frozen current helper mismatch')
    frozen = REPORT.parent / 'pricing-staged-build-attempt1/isolated-build-staging.py'
    if digest(frozen) != next(iter(old['helper'].values())):
        raise RuntimeError('Frozen archived helper mismatch')
    owner = DEPENDENCIES.parent.lstat()
    if owner.st_uid != os.getuid() or owner.st_mode & 0o077 or DEPENDENCIES.parent.is_symlink():
        raise RuntimeError('Unsafe staging owner')
    tree = load_json(tree_path)
    files, links = tree['files'], tree['links']
    binary = shutil.which('node')
    if binary is None:
        raise RuntimeError('Node unavailable')
    node = Path(binary).resolve()
    root = Path(tempfile.mkdtemp(prefix='9router-pricing-measured-'))
    for name in ['home', 'data', 'tmp', 'cache']:
        (root / name).mkdir(mode=0o700)
    dist = '.next-pricing-measured-' + root.name.rsplit('-', 1)[-1]
    spec = importlib.util.spec_from_file_location('observer', REPORT / 'measure.py')
    if spec is None or spec.loader is None:
        raise RuntimeError('Observer module loader unavailable')
    observer = cast(Any, importlib.util.module_from_spec(spec))
    spec.loader.exec_module(observer)
    observer.OUTPUT = root / 'fixture.jsonl'
    observer.SIDE = 'fixture'
    left, send = socket.socketpair()
    receive, right = socket.socketpair()
    thread = threading.Thread(target=observer.relay, args=(left, right), daemon=True)
    thread.start()
    try:
        receive.settimeout(2)
        send.sendall(b'fixture-in')
        if receive.recv(100) != b'fixture-in':
            raise RuntimeError('Relay forward mismatch')
        receive.sendall(b'fixture-out')
        send.settimeout(2)
        if send.recv(100) != b'fixture-out':
            raise RuntimeError('Relay reverse mismatch')
        send.shutdown(socket.SHUT_WR)
        thread.join(timeout=2)
        if thread.is_alive():
            raise RuntimeError('Relay fixture did not exit')
    finally:
        for connection in [left, right, send, receive]:
            connection.close()
    if not observer.sample(os.getpid())['processes']:
        raise RuntimeError('Process sampler failed')
    fixture = [decode_json(line) for line in observer.OUTPUT.read_text().splitlines()]
    if fixture[-1]['event'] != 'relay_end' or fixture[-1]['leftBytes'] != 10 or fixture[-1]['rightBytes'] != 11:
        raise RuntimeError('Relay accounting failed')
    for close_reverse in [True, False]:
        a, b = socket.socketpair()
        c, d = socket.socketpair()
        control = threading.Thread(target=observer.relay, args=(a, d), daemon=True)
        control.start()
        try:
            (c if close_reverse else b).shutdown(socket.SHUT_WR)
            control.join(timeout=2)
            if control.is_alive():
                raise RuntimeError('Relay EOF control failed')
        finally:
            for connection in [a, b, c, d]:
                connection.close()
    manifest = {'root':str(root), 'repo':str(REPO), 'dependencies':str(DEPENDENCIES), 'dist':dist,
                'node':str(node), 'nodeVersion':subprocess.check_output([str(node), '--version'], text=True).strip(),
                'sourceHashes':sources, 'helperHashes':{str(p.relative_to(REPO)):digest(p) for p in [REPORT/'measure.py', REPORT/'prepare-r2.py', REPORT/'verify-r2.py', observer.BASE]},
                'rootLockSha256':digest(REPO/'package-lock.json'), 'stagingLockSha256':old['stagingLockSha256'],
                'dependencyManifestSha256':digest(tree_path),
                'inventory':{'files':len(files), 'links':len(links)},
                'profile':'2CPU affinity,2048MiB per Node heap,900s inner/930s outer; observation only; proxy semantics unchanged',
                'preparedAt':time.time()}
    (REPORT / 'inputs-r2.json').write_text(json.dumps(manifest, indent=2))
    print('INPUTS PASS', json.dumps({k:manifest[k] for k in ['root','dist','node','nodeVersion','inventory']}), flush=True)
    env = dict(os.environ, BUILD_NODE=str(node), PYTHONDONTWRITEBYTECODE='1')
    command = [sys.executable, '-B', str(REPORT/'measure.py'), '--root', str(root), '--repo', str(REPO), '--dependencies', str(DEPENDENCIES), '--dist', dist, '--mode', 'preflight']
    with (root/'preflight-output.log').open('wb') as output:
        result = subprocess.run(command, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=45)
    (root/'preflight-exit.txt').write_text(str(result.returncode)+'\n')
    if result.returncode:
        raise RuntimeError('Preflight failed; inspect exact log')
    (REPORT/'prepared-r2.json').write_text(json.dumps({'status':'pass', 'root':str(root), 'sourceCount':len(sources), 'inventory':manifest['inventory'], 'fixture':'pass', 'preflight':'pass'}, indent=2))
    print('PREFLIGHT PASS', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print('PREPARE FAILED: ' + type(error).__name__ + ': ' + str(error)[:200], flush=True)
        sys.exit(1)
