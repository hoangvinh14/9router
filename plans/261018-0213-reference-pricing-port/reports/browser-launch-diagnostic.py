"""Capture cached browser version and actual exit signal; no application test."""
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1])
binary = sys.argv[2]
results = []
for name, arguments, budget in [
    ("version", ["--version"], 5),
    ("launch", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage",
                "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-extensions",
                "--enable-logging=stderr", "--v=1", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
                f"--user-data-dir={root / 'profile'}", "about:blank"], 12),
]:
    with (root / f"{name}-stdout.log").open("wb") as stdout, (root / f"{name}-stderr.log").open("wb") as stderr:
        process = subprocess.Popen([binary, *arguments], stdout=stdout, stderr=stderr, start_new_session=True)
        timed_out = False
        try:
            code = process.wait(timeout=budget)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGTERM)
            try:
                code = process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                code = process.wait()
        results.append({"name": name, "returnCode": code, "signal": -code if code < 0 else None, "diagnosticTimeout": timed_out})
(root / "diagnosis.json").write_text(json.dumps(results, indent=2))
