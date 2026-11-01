#!/usr/bin/env python3
"""Offline exact collection/integrity check; never imports application code."""
import hashlib
import json
import pathlib
import sys
from collections import Counter

bundle = pathlib.Path(__file__).resolve().parent
reports = [pathlib.Path(value) for value in sys.argv[1:]]
if not reports:
    raise SystemExit('Provide exact preserved Vitest JSON reports')
try:
    exceptions = json.loads((bundle/'inherited-title-collisions.json').read_text())['exceptions']
    expected_counts = json.loads((bundle/'expected-assertion-counts.json').read_text())
except (ValueError, OSError, KeyError) as error:
    raise SystemExit(f'Invalid collision/count inventory: {error}') from error
allowed = {(item['suite'], item['fullName']): item['multiplicity'] for item in exceptions}
assert len(allowed) == len(exceptions)
repo = bundle.parents[3]
for item in exceptions:
    source = repo/'tests'/item['suite']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == item['sourceSha256'], ('inherited source drift', item['suite'])
identities = []
suites = set()
observed_collisions = {}
for report in reports:
    try:
        data = json.loads(report.read_text())
    except (ValueError, OSError) as error:
        raise SystemExit(f'Invalid report {report}: {error}') from error
    assert data['success'] and data['numFailedTests'] == 0, report
    assert data['numPendingTests'] == 0 and data.get('numTodoTests', 0) == 0, report
    counted = 0
    for suite in data['testResults']:
        name = suite['name'].split('/tests/')[-1]
        assert name not in suites, ('duplicate suite', name)
        suites.add(name)
        assert suite['status'] == 'passed' and suite['assertionResults'], (report, name)
        assert len(suite['assertionResults']) == expected_counts[name], ('assertion count drift', name)
        multiplicities = Counter(case['fullName'] for case in suite['assertionResults'])
        for title, count in multiplicities.items():
            if count > 1:
                key = (name, title)
                assert allowed.get(key) == count, ('unexpected title collision', key, count)
                observed_collisions[key] = count
        ordinals = Counter()
        for case in suite['assertionResults']:
            identity = (name, case['fullName'])
            ordinals[case['fullName']] += 1
            assert case['status'] == 'passed', identity
            identities.append({'suite': name, 'name': case['fullName'], 'occurrence': ordinals[case['fullName']],
                               'status': case['status'], 'report': report.name})
            counted += 1
    assert counted == data['numTotalTests'], (report, counted, data['numTotalTests'])
assert observed_collisions == allowed, 'Missing or changed inherited collision multiplicity'
expected_file = bundle / 'expected-suites.json'
if expected_file.exists():
    try:
        expected = set(json.loads(expected_file.read_text()))
    except (ValueError, OSError) as error:
        raise SystemExit(f'Invalid expected inventory: {error}') from error
    assert suites == expected, {'missing': sorted(expected-suites), 'extra': sorted(suites-expected)}
for name in sorted(suites):
    if name.startswith('unit/embeddings-') and name not in ['unit/embeddings-accounting-usage.test.js']:
        cases = [case['name'] for case in identities if case['suite'] == name]
        # Reader-only tests coexist with real socket adapter cases in transport.
        assert any(case.startswith('node ') for case in cases), name
        assert any(case.startswith('sqljs ') for case in cases), name
(bundle / 'test-identities.json').write_text(json.dumps(identities, indent=2)+'\n')
checksums = {report.name: hashlib.sha256(report.read_bytes()).hexdigest() for report in reports}
(bundle / 'report-checksums.json').write_text(json.dumps(checksums, indent=2)+'\n')
print(json.dumps({'reports': len(reports), 'suites': len(suites), 'assertions': len(identities), 'inheritedTitleCollisions': len(observed_collisions), 'missing': [], 'failed': 0, 'skipped': 0}))
