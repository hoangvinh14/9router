"""Owned disposable build: read-only checkout + net namespace + font CONNECT gate.
Not a memory reservation or a general-purpose proxy. No agent subprocesses.
"""
import argparse
import errno
import json
import os
import select
import signal
import socket
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

ALLOWED = {"fonts.googleapis.com:443", "fonts.gstatic.com:443"}


def relay(left, right):
    left.settimeout(None)
    right.settimeout(None)
    while True:
        ready, _, _ = select.select([left, right], [], [], 30)
        if not ready:
            return
        for source in ready:
            data = source.recv(65536)
            if not data:
                return
            (right if source is left else left).sendall(data)


class ThreadedUnix(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


class ThreadedTCP(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True


def inside(root, repo, dist, mode):
    class Bridge(socketserver.BaseRequestHandler):
        def handle(self):
            with socket.socket(socket.AF_UNIX) as upstream:
                upstream.connect(str(root / "font-proxy.sock"))
                try:
                    relay(self.request, upstream)
                except OSError:
                    return

    with ThreadedTCP(("127.0.0.1", 0), Bridge) as bridge:
        threading.Thread(target=bridge.serve_forever, daemon=True).start()
        proxy = f"http://127.0.0.1:{bridge.server_address[1]}"
        if mode == "preflight":
            results = {}
            for target, expected in [("models.dev:443", 403), ("127.0.0.1:20128", 403), ("fonts.googleapis.com:443", 200), ("fonts.gstatic.com:443", 200)]:
                with socket.create_connection(("127.0.0.1", int(bridge.server_address[1])), timeout=10) as connection:
                    connection.sendall(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
                    header = connection.recv(1024)
                    code = int(header.split(b" ")[1])
                    if code != expected:
                        raise RuntimeError("Font gate control failed")
                    results[target] = code
            try:
                with socket.create_connection(("1.1.1.1", 443), timeout=1):
                    raise RuntimeError("Namespace unexpectedly has direct egress")
            except OSError:
                results["directEgress"] = "denied"
            probe = repo / ".pricing-readonly-probe"
            try:
                with probe.open("x"):
                    pass
            except OSError as error:
                if error.errno != errno.EROFS:
                    raise
                results["checkoutWrite"] = "denied EROFS"
            else:
                probe.unlink()
                raise RuntimeError("Checkout unexpectedly writable")
            if Path("/home/gmo/.ssh").exists() or Path("/home/gmo/.pi").exists():
                raise RuntimeError("Host credential directories visible")
            results["hostHome"] = "masked"
            # The PID namespace must kill this descendant when its init exits.
            marker = f"pricing-cleanup-{root.name}"
            child = subprocess.Popen(["/bin/bash", "-c", f"exec -a {marker} /bin/sleep 60"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            # Confirm the marked executable exists before init exits. A bounded
            # readiness loop is a lifecycle control, not a task polling loop.
            import time
            deadline = time.monotonic() + 3
            while Path(f"/proc/{child.pid}/cmdline").read_bytes().split(b"\0", 1)[0] != marker.encode():
                if time.monotonic() >= deadline:
                    raise RuntimeError("Cleanup probe never became ready")
                time.sleep(0.01)
            results["descendantReady"] = True
            (root / "network-result.json").write_text(json.dumps(results, indent=2))
            return 0
        env = dict(os.environ, HTTPS_PROXY=proxy, HTTP_PROXY=proxy, https_proxy=proxy, http_proxy=proxy)
        command = ["/usr/bin/taskset", "-c", env["BUILD_CPUS"], env["NODE_BINARY"], env["NPM_CLI"], "run", "build"]
        with (root / "build-output.log").open("wb") as output:
            process = subprocess.Popen(command, cwd=repo, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = process.wait(timeout=900)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                code = 124
        (root / "build-exit.txt").write_text(str(code) + "\n")
        return code


def outside(root, repo, dist, mode):
    # Supplied root is created by this session; refuse a shared/symlink root.
    info = root.lstat()
    if root.is_symlink() or not root.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("Unsafe fixture root")
    if Path(dist).name != dist or not dist.startswith(".next-pricing-"):
        raise RuntimeError("Unsafe isolated dist name")
    events = []
    lock = threading.Lock()

    class Gate(socketserver.BaseRequestHandler):
        def handle(self):
            self.request.settimeout(15)
            data = b""
            while b"\r\n\r\n" not in data and len(data) < 8192:
                part = self.request.recv(1024)
                if not part:
                    return
                data += part
            line = data.split(b"\r\n", 1)[0].decode("ascii", errors="replace").split(" ")
            allowed = len(line) == 3 and line[0] == "CONNECT" and line[1] in ALLOWED and line[2] == "HTTP/1.1" and data.endswith(b"\r\n\r\n")
            with lock:
                events.append({"target": line[1] if len(line) > 1 else "invalid", "allowed": allowed})
            if not allowed:
                self.request.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                return
            host = line[1].split(":")[0]
            try:
                with socket.create_connection((host, 443), timeout=15) as remote:
                    self.request.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                    relay(self.request, remote)
            except OSError:
                return

    node = Path(os.environ["BUILD_NODE"])
    env = {"PATH": f"{node.parent}:/usr/bin:/bin", "HOME": str(root / "home"), "DATA_DIR": str(root / "data"),
           "TMPDIR": str(root / "tmp"), "XDG_CACHE_HOME": str(root / "cache"), "NODE_BINARY": str(node),
           "NPM_CLI": str(node.parent.parent / "lib/node_modules/npm/bin/npm-cli.js"), "NEXT_DIST_DIR": dist,
           "NEXT_PHASE": "phase-production-build", "NODE_ENV": "production", "NEXT_TELEMETRY_DISABLED": "1",
           "MODEL_CATALOG_SYNC": "off", "DISABLE_BACKGROUND_TOKEN_REFRESH": "true", "NODE_OPTIONS": "--max-old-space-size=2048",
           "JWT_SECRET": "isolated-build-fixture-not-production", "INITIAL_PASSWORD": "isolated-build-fixture-only",
           "BUILD_CPUS": ",".join(str(cpu) for cpu in sorted(os.sched_getaffinity(0))[:2])}
    if mode == "build":
        (repo / dist).mkdir(mode=0o700)
    with ThreadedUnix(str(root / "font-proxy.sock"), Gate) as gate:
        threading.Thread(target=gate.serve_forever, daemon=True).start()
        command = ["bwrap", "--die-with-parent", "--unshare-user", "--unshare-net", "--unshare-pid",
                   "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/sbin", "/sbin",
                   "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib64", "/lib64",
                   "--proc", "/proc", "--dev", "/dev",
                   "--tmpfs", "/tmp",  # noqa: S108 -- Private namespace mount destination, not a host temp file.
                   "--ro-bind", "/etc/ssl/certs", "/etc/ssl/certs", "--ro-bind", "/etc/fonts", "/etc/fonts",
                   "--ro-bind", str(node.parent.parent), str(node.parent.parent),
                   "--ro-bind", str(repo), str(repo), "--tmpfs", str(repo / ".git"), "--tmpfs", str(repo / ".pi"),
                   "--bind", str(root), str(root), "--chdir", str(repo)]
        # A read-only bind mount, rather than permissions, enforces the source
        # boundary. No other host home/run/etc credential trees are mounted.
        if mode == "build":
            command += ["--bind", str(repo / dist), str(repo / dist)]
        command += [sys.executable, "-S", str(Path(__file__).resolve()), "--inside", "--root", str(root), "--repo", str(repo), "--dist", dist, "--mode", mode]
        try:
            code = subprocess.run(command, env=env, timeout=930, check=False).returncode
            if mode == "preflight":
                marker = f"pricing-cleanup-{root.name}".encode()
                for entry in Path("/proc").iterdir():
                    if entry.name.isdigit():
                        try:
                            if (entry / "cmdline").read_bytes().split(b"\0", 1)[0] == marker:
                                raise RuntimeError("PID namespace leaked descendant")
                        except (FileNotFoundError, PermissionError, ProcessLookupError):
                            continue
        finally:
            (root / "proxy-events.json").write_text(json.dumps(events, indent=2))
            (root / "font-proxy.sock").unlink(missing_ok=True)
    return code


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--dist", required=True)
    parser.add_argument("--mode", choices=["preflight", "build"], required=True)
    parser.add_argument("--inside", action="store_true")
    args = parser.parse_args()
    run = inside if args.inside else outside
    return run(args.root, args.repo, args.dist, args.mode)


if __name__ == "__main__":
    sys.exit(main())
