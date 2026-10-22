"""Add observation only to the frozen staged build helper; never log argv/payloads."""
import importlib.util
import json
import os
import select
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any, cast

BASE = Path(__file__).resolve().parent.parent / "pricing-staged-build-attempt1/isolated-build-staging.py"
BASE_SHA256 = "a0973400bcae45d4ccbf205586fb3d243452401fab9518ccfdb660c60cc9420b"
LOCK = threading.Lock()
ACTIVE = {}
OUTPUT = None
SIDE = "fixture"


def emit(kind, **fields):
    if OUTPUT is not None:
        record = dict(event=kind, wall=time.time(), mono=time.monotonic(), side=SIDE, **fields)
        try:
            with LOCK, OUTPUT.open("a") as stream:
                stream.write(json.dumps(record) + "\n")
        except OSError:
            # Observation failures must never bypass watchdog/termination paths.
            pass


def relay(left, right):
    # Preserve original blocking sockets and 30s select semantics: this run
    # measures existing behavior, not a trial network fix.
    left.settimeout(None)
    right.settimeout(None)
    identity = id(left)
    state = {"start": time.monotonic(), "leftBytes": 0, "rightBytes": 0, "phase": "select"}
    with LOCK:
        ACTIVE[identity] = state
    emit("relay_start", connection=identity)
    reason = "unknown"
    try:
        while True:
            state["phase"] = "select"
            ready, _, _ = select.select([left, right], [], [], 30)
            if not ready:
                reason = "idle30s"
                return
            for source in ready:
                state["phase"] = "recv"
                data = source.recv(65536)
                if not data:
                    reason = "eof"
                    return
                key = "leftBytes" if source is left else "rightBytes"
                state[key] += len(data)
                state["phase"] = "send_left" if source is right else "send_right"
                (right if source is left else left).sendall(data)
    except OSError as error:
        reason = type(error).__name__
        raise
    finally:
        with LOCK:
            ACTIVE.pop(identity, None)
        emit("relay_end", connection=identity, reason=reason, **state)


def stat_process(pid):
    root = Path("/proc") / str(pid)
    text = (root / "stat").read_text()
    fields = text[text.rfind(")") + 2:].split()
    result = {"pid": pid, "name": text[text.find("(") + 1:text.rfind(")")], "state": fields[0],
              "ppid": int(fields[1]), "ticks": int(fields[11]) + int(fields[12]),
              "startTicks": int(fields[19]), "rssBytes": int(fields[21]) * os.sysconf("SC_PAGE_SIZE")}
    try:
        result["wchan"] = (root / "wchan").read_text().strip()
        io = dict(line.split(":", 1) for line in (root / "io").read_text().splitlines())
        result["readBytes"] = int(io["read_bytes"])
        result["writeBytes"] = int(io["write_bytes"])
        status = dict(line.split(":", 1) for line in (root / "status").read_text().splitlines() if ":" in line)
        result["swapKiB"] = int(status.get("VmSwap", "0 kB").split()[0])
        result["allowedCpus"] = status.get("Cpus_allowed_list", "unknown").strip()
    except (OSError, ValueError, KeyError):
        result["partial"] = True
    return result


def sample(pid):
    # Read relationship/stat only across /proc, then detailed IO only for owned
    # descendants. Never collect unrelated command lines, environ or credentials.
    rows = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            text = (entry / "stat").read_text()
            fields = text[text.rfind(")") + 2:].split()
            rows[int(entry.name)] = int(fields[1])
        except (OSError, ValueError, IndexError):
            continue
    owned = {pid}
    while True:
        expanded = owned | {child for child, parent in rows.items() if parent in owned}
        if expanded == owned:
            break
        owned = expanded
    processes = []
    for child in sorted(owned):
        try:
            processes.append(stat_process(child))
        except (OSError, ValueError, IndexError):
            continue
    host = {}
    for name in ["meminfo", "vmstat", "stat", "pressure/memory", "pressure/io", "pressure/cpu"]:
        try:
            host[name] = (Path("/proc") / name).read_text()
        except OSError:
            host[name] = "unavailable"
    with LOCK:
        active = {str(key):dict(value) for key, value in ACTIVE.items()}
    return {"processes": processes, "host": host, "activeRelays": active}


def monitor(pid, stop):
    while True:
        try:
            emit("sample", **sample(pid))
        except Exception as error:
            emit("sample_error", error=type(error).__name__)
        if stop.wait(5):
            return


def main():
    import hashlib
    global OUTPUT, SIDE
    if hashlib.sha256(BASE.read_bytes()).hexdigest() != BASE_SHA256:
        raise RuntimeError("Frozen helper mismatch")
    fixture = "--lifecycle-fixture" in sys.argv
    if fixture:
        sys.argv.remove("--lifecycle-fixture")
    root = Path(sys.argv[sys.argv.index("--root") + 1])
    SIDE = "inside" if "--inside" in sys.argv else "outside"
    OUTPUT = root / ("measurement-" + SIDE + ".jsonl")
    spec = importlib.util.spec_from_file_location("frozen_build", BASE)
    if spec is None or spec.loader is None:
        raise RuntimeError("Frozen helper loader unavailable")
    base = cast(Any, importlib.util.module_from_spec(spec))
    spec.loader.exec_module(base)
    # Original helper re-execs __file__ in bwrap. Point it at this observer.
    base.__file__ = str(Path(__file__).resolve())
    base.relay = relay
    original_popen = subprocess.Popen
    original_killpg = os.killpg
    original_connect = socket.create_connection

    class ObservedPopen(original_popen):
        def __init__(self, args, *positional, **kwargs):
            self.role = "namespace" if args[0] == "bwrap" else "build" if args[0] == "/usr/bin/taskset" else "other"
            if self.role == "namespace":
                args = list(args)
                if (root / "worker-config.mjs").exists():
                    position = args.index("--chdir")
                    args[position:position] = ["--ro-bind", str(root / "worker-config.mjs"), str(Path(sys.argv[sys.argv.index("--repo") + 1]) / "next.config.mjs")]
                if fixture:
                    args.append("--lifecycle-fixture")
            elif fixture and self.role == "build":
                payload = "import os,signal,subprocess,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); p=subprocess.Popen(['/bin/sleep','60']); print('FIXTURE_PAYLOAD',os.getpid(),p.pid,flush=True); time.sleep(60)"
                args = [sys.executable, "-S", "-c", payload]
            super().__init__(args, *positional, **kwargs)
            emit("process_start", pid=self.pid, role=self.role)
            self.observer_stop = threading.Event()
            self.observer = None
            if self.role == "namespace" and SIDE == "outside":
                self.observer = threading.Thread(target=monitor, args=(self.pid, self.observer_stop), daemon=True)
                self.observer.start()

        def wait(self, timeout=None):
            if fixture:
                timeout = 2 if timeout == 900 else 20 if timeout == 930 else timeout
            try:
                code = super().wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                emit("wait_expired", pid=self.pid, role=self.role, seconds=timeout)
                raise
            emit("process_exit", pid=self.pid, role=self.role, code=code)
            self.observer_stop.set()
            if self.observer is not None:
                self.observer.join(timeout=2)
            return code

    def killpg(pgid, sig):
        emit("signal_group", pgid=pgid, signal=signal.Signals(sig).name)
        return original_killpg(pgid, sig)

    def connect(address, *args, **kwargs):
        # All expected targets are numeric loopback or the exact font allowlist.
        host, port = address
        label = host if host in {"127.0.0.1", "1.1.1.1", "fonts.googleapis.com", "fonts.gstatic.com"} else "redacted"
        start = time.monotonic()
        emit("connect_start", host=label, port=port)
        try:
            result = original_connect(address, *args, **kwargs)
        except OSError as error:
            emit("connect_error", host=label, elapsed=time.monotonic()-start, error=type(error).__name__)
            raise
        emit("connect_ready", host=label, elapsed=time.monotonic()-start)
        return result

    subprocess.Popen = ObservedPopen
    os.killpg = killpg
    socket.create_connection = connect
    emit("observer_start", interval=5, clockTicks=os.sysconf("SC_CLK_TCK"))
    try:
        code = base.main()
        emit("observer_exit", code=code, threads=[{"name": t.name, "daemon": t.daemon, "alive": t.is_alive()} for t in threading.enumerate()])
        return code
    except BaseException as error:
        emit("observer_error", error=type(error).__name__)
        raise


if __name__ == "__main__":
    sys.exit(main())
