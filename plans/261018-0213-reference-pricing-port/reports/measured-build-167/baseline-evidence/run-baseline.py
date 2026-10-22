"""One authorized baseline build; no retry, install, or product mutation."""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]


def load(path):
    try:
        return json.loads(path.read_text())
    except (OSError, UnicodeError, ValueError):
        raise RuntimeError('Invalid build handoff JSON') from None


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def main():
    prepared = load(HERE/'prepared-r2.json')
    inputs = load(HERE/'inputs-r2.json')
    if prepared.get('status') != 'pass' or prepared.get('root') != inputs['root']:
        raise RuntimeError('No matched successful preflight')
    if not 0 <= time.time() - inputs['preparedAt'] < 900:
        raise RuntimeError('Preflight handoff expired')
    if (HERE/'baseline-inputs.json').exists():
        raise RuntimeError('Baseline already manifested; refusing retry')
    for name, expected in {**inputs['sourceHashes'], **inputs['helperHashes']}.items():
        if digest(REPO/name) != expected:
            raise RuntimeError('Changed frozen build input: '+name)
    if digest(REPO/'package-lock.json') != inputs['rootLockSha256']:
        raise RuntimeError('Root lock changed')
    deps = Path(inputs['dependencies'])
    if digest(deps/'package-lock.json') != inputs['stagingLockSha256']:
        raise RuntimeError('Staging lock changed')
    root = Path(tempfile.mkdtemp(prefix='9router-pricing-measured-build-'))
    for name in ['home', 'data', 'tmp', 'cache']:
        (root/name).mkdir(mode=0o700)
    dist = '.next-pricing-measured-'+root.name.rsplit('-', 1)[-1]
    inputs.update(root=str(root), dist=dist, launchTime=time.time(), launcherHash=digest(Path(__file__)))
    (HERE/'baseline-inputs.json').write_text(json.dumps(inputs, indent=2))
    env = dict(os.environ, BUILD_NODE=inputs['node'], PYTHONDONTWRITEBYTECODE='1')
    command = [sys.executable, '-B', str(HERE/'measure.py'), '--root', str(root), '--repo', str(REPO),
               '--dependencies', str(deps), '--dist', dist, '--mode', 'build']
    print('BASELINE START', root, dist, flush=True)
    with (root/'runner-output.log').open('wb') as output:
        try:
            code = subprocess.run(command, env=env, stdout=output, stderr=subprocess.STDOUT, timeout=950).returncode
        except subprocess.TimeoutExpired:
            (root/'launcher-timeout.txt').write_text('950s launcher timeout; descendant state unconfirmed\n')
            print('LAUNCHER TIMEOUT', flush=True)
            return 124
    (root/'runner-exit.txt').write_text(str(code)+'\n')
    print('BASELINE END', code, root, flush=True)
    return code


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, KeyError, ValueError, RuntimeError) as error:
        print('LAUNCH FAILED', type(error).__name__, str(error)[:200], flush=True)
        sys.exit(1)
