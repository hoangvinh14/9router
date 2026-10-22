import json
import os
import pathlib
import signal
import subprocess

root = pathlib.Path(__file__).resolve().parent
command = ['node', '--experimental-loader', str(root / 'loader.mjs'), str(root / 'probe.mjs')]
with (root / 'output.log').open('wb') as output:
    process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    reason = 'process-exited'
    try:
        code = process.wait(timeout=60)
    except subprocess.TimeoutExpired:
        reason = 'external-60s-watchdog'
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        code = 124
(root / 'watchdog.json').write_text(json.dumps({'command': command, 'reason': reason, 'exitCode': code}, indent=2))
(root / 'exit-code.txt').write_text(str(code) + '\n')
raise SystemExit(code)
