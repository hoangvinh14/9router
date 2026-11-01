#!/usr/bin/env python3
"""Run only the authorized isolated runner; fail on drift or any failed batch."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

repo = pathlib.Path(__file__).resolve().parents[4]
bundle = pathlib.Path(__file__).resolve().parent

def digest(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()

def manifest():
    paths = [file for root in ['src', 'open-sse', 'tests'] for file in (repo/root).rglob('*')
             if file.is_file() and 'node_modules' not in file.parts]
    paths += [repo/name for name in ['package.json', 'package-lock.json', 'jsconfig.json', 'next.config.mjs', 'eslint.config.mjs',
              'tests/package.json', 'tests/package-lock.json', 'tests/node_modules/vitest/package.json',
              'node_modules/sql.js/package.json', 'node_modules/sql.js/dist/sql-wasm.wasm'] if (repo/name).is_file()]
    return {str(file.relative_to(repo)): digest(file) for file in sorted(set(paths))}

try:
    commands = json.loads((bundle/'final-commands.json').read_text())
except (ValueError, OSError) as error:
    raise SystemExit(f'Invalid commands: {error}') from error
verification_files = ['run-final.py','verify-reports.py','final-commands.json','expected-suites.json',
                      'expected-assertion-counts.json','inherited-title-collisions.json']
verification_before = {name:digest(bundle/name) for name in verification_files}
(bundle/'verification-inputs.json').write_text(json.dumps(verification_before,indent=2)+'\n')
before = manifest()
(bundle/'source-before.json').write_text(json.dumps(before, indent=2)+'\n')
runtime = {'node': subprocess.check_output(['node', '--version'], text=True).strip(),
           'nodeBinarySha256': digest(pathlib.Path(subprocess.check_output(['which','node'],text=True).strip()).resolve()),
           'bwrapSha256': digest(pathlib.Path('/usr/bin/bwrap')),
           'platform': sys.platform, 'commands': commands,
           'note': 'Source and runtime hashes captured before all batches; sanitized environment owned by hashed isolated runner.'}
(bundle/'invocation.json').write_text(json.dumps(runtime, indent=2)+'\n')
reports = []
for index, command in enumerate(commands, 1):
    assert manifest() == before, 'Source drift before batch'
    assert {name:digest(bundle/name) for name in verification_files} == verification_before, 'Verifier input drift'
    assert command.startswith('node tests/fixtures/accounting/run-isolated.mjs ')
    log = bundle/f'final-batch-{index}.log'
    print(f'Launching isolated batch {index}/{len(commands)}', flush=True)
    with log.open('w') as output:
        result = subprocess.run(command.split(), cwd=repo, stdout=output, stderr=subprocess.STDOUT, timeout=650)
    text = log.read_text()
    match = re.search(r'JSON report written to (.+)', text)
    summaries = [json.loads(line) for line in text.splitlines() if line.startswith('{"kind":"r1-isolated-run"')]
    assert len(summaries) == 1 and summaries[0]['error'] is None and summaries[0]['outsideArtifacts'] == [], 'Runner/isolation failure: STOP'
    assert match, 'Missing raw report: STOP'
    report = bundle/f'final-batch-{index}-results.json'
    report.write_bytes(pathlib.Path(match[1]).read_bytes())
    reports.append(str(report))
    after = manifest()
    (bundle/'source-after.json').write_text(json.dumps(after, indent=2)+'\n')
    assert after == before, 'Source drift: rerun all invalidated gates'
    print(f'Batch {index} exit={result.returncode}; raw report preserved', flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)
    comparator = subprocess.run(['node','tests/__baseline__/verify-no-regression.mjs',str(report)],cwd=repo,capture_output=True,text=True)
    (bundle/f'final-batch-{index}-comparator.txt').write_text(comparator.stdout+comparator.stderr)
    assert comparator.returncode == 0, 'Original comparator failed'
assert {name:digest(bundle/name) for name in verification_files} == verification_before, 'Verifier input drift'
subprocess.run(['python3',str(bundle/'verify-reports.py'),*reports],cwd=repo,check=True)
(bundle/'integrity-review.json').write_text(json.dumps({'unchangedInputs': True, 'sourceFiles':len(before), 'batches':len(commands),
    'sourceManifestSha256':digest(bundle/'source-before.json'), 'note':'Exact raw assertions checked separately. Baseline unmatched identities are not historical baseline passes.'},indent=2)+'\n')
print('Final isolated collection and unchanged-source integrity checks passed',flush=True)
