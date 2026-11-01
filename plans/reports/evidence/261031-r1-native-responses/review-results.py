import json, sys, hashlib, subprocess
from pathlib import Path
report=Path(sys.argv[1]); before=json.loads(Path('/tmp/r1-final-source-before.json').read_text())
r=json.loads(report.read_text())
expected='''accounting-fixture-isolation responses-accounting-usage responses-accounting-json responses-accounting-json-boundary responses-accounting-pricing responses-accounting-late-sink responses-accounting-stream responses-accounting-consumers responses-stream-to-json-contract responses-converter-callers responses-accounting-loopback responses-budget-loopback responses-accounting-restart responses-accounting-final-controls chat-accounting-json chat-accounting-loopback chat-accounting-stream chat-accounting-stream-loopback chat-accounting-final-controls chat-budget-loopback chat-budget-process-restart chat-budget-pricing-fallback accounting-persisted-authority accounting-request-authority accounting-budget-gate accounting-budget-projection accounting-crash accounting-transport-boundary default-executor-accounting-compatibility b1-ledger-disposition b1-usage-evidence b1-late-chat-sink budget-activation-boundary key-budget-management-security openai-responses-nonstream openai-responses-terminal-event openai-responses-completed-usage openai-responses-usage-pivot openai-responses-completion-watchdog responses-abort-terminal github-responses-routing embeddingsCore'''.split()
actual=[Path(f['name']).name.removesuffix('.test.js') for f in r['testResults']]
assert len(expected)==42
missing=sorted(set(expected)-set(actual));extra=sorted(set(actual)-set(expected));duplicates=sorted(f for f in actual if actual.count(f)>1)
changed=[p for p,h in before['files'].items() if not Path(p).is_file() or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
identities=[];failures=[];nonpassed=[];empty=[]
for f in r['testResults']:
 if not f.get('assertionResults'):empty.append({'file':f['name'],'message':f.get('message')})
 for a in f.get('assertionResults',[]):
  row={'file':f['name'],'test':a['fullName'],'status':a['status']};identities.append(row)
  if a['status']!='passed':nonpassed.append(row)
  if a['status']=='failed':failures.append({**row,'messages':a.get('failureMessages')})
baseline=json.loads(Path('tests/__baseline__/baseline-results.json').read_text());base={}
for f in baseline['testResults']:
 for a in f.get('assertionResults',[]):base[(Path(f['name']).name,a['fullName'])]=a['status']
matched=[i for i in identities if (Path(i['file']).name,i['test']) in base]
summary={'report':str(report),'manifest':'/tmp/r1-final-source-before.json','revision':before['revision'],'sourceChanges':changed,'expectedSuites':len(expected),'actualSuites':len(actual),'missingSuites':missing,'extraSuites':extra,'duplicateSuites':duplicates,'emptySuites':empty,'totals':{k:r.get(k) for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTodoTests','success']},'assertionCount':len(identities),'nonpassed':nonpassed,'failures':failures,'baselineMatchedIdentities':len(matched),'baselineUnmatchedIdentities':len(identities)-len(matched),'baselinePathCaveat':'Original comparator uses /app/ path split; not sufficient to verify collection/omissions. Raw paths retained. Baseline match here uses filename+fullName explicitly for review, not to alter original comparator.'}
Path('/tmp/r1-final-review.json').write_text(json.dumps(summary,indent=2)+'\n');Path('/tmp/r1-final-identities.json').write_text(json.dumps(identities,indent=2)+'\n')
print(json.dumps(summary,indent=2))
assert not (changed or missing or extra or duplicates or empty or nonpassed)
assert len(identities)==r['numTotalTests']==r['numPassedTests'] and r['success'] is True
