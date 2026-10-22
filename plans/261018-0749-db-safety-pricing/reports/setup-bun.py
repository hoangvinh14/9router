"""One pinned Bun download/extraction; no installation or execution."""

import hashlib
import json
import os
import pathlib
import stat
import sys
import time
import urllib.parse
import urllib.request
import zipfile


def require(condition, message="Safety boundary rejected"):
    if not condition:
        raise ValueError(message)


def main():
    supplied = pathlib.Path(sys.argv[1])
    require(
        stat.S_ISDIR(supplied.lstat().st_mode),
        "Root must be a real directory, not a symlink",
    )
    root = supplied.resolve(strict=True)
    # Caller-created mktemp directory, validated owner/mode; no predictable temp creation.
    require(root.parent == pathlib.Path("/tmp"))  # nosec B108
    require(root.name.startswith("9router-db-safety-bun-"))
    require(root.stat().st_uid == os.getuid())
    require(root.stat().st_mode & 0o077 == 0)
    started = time.monotonic()
    hosts = {
        "github.com",
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
    }
    redirects = []
    receipt = {"status": "failed", "redirects": redirects, "runtimeExecuted": False}

    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            url = urllib.parse.urlsplit(newurl)
            require(url.scheme == "https" and url.hostname in hosts)
            require(not url.username and not url.password and len(redirects) < 4)
            redirects.append({"host": url.hostname, "path": url.path, "status": code})
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    try:
        url = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-linux-x64-baseline.zip"
        expected = "1fc2edac843102909e3a1be1d8d9802cc6071cf074e67e88231f4ffe0f8b397b"
        receipt.update(url=url, expectedSha256=expected)
        archive = root / "bun.zip"
        with urllib.request.build_opener(Redirect()).open(
            urllib.request.Request(url, headers={"User-Agent": "db-safety-pinned-bun"}),
            timeout=20,
        ) as response:
            final = urllib.parse.urlsplit(response.url)
            require(final.scheme == "https" and final.hostname in hosts)
            receipt.update(finalHost=final.hostname, finalPath=final.path)
            size = 0
            with archive.open("xb") as out:
                while True:
                    require(time.monotonic() - started < 110)
                    chunk = response.read(65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    require(size <= 48_000_000)
                    out.write(chunk)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        receipt.update(size=size, sha256=digest)
        require(size == 42015103 and digest == expected)
        with zipfile.ZipFile(archive) as package:
            members = package.infolist()
            receipt["members"] = []
            seen = set()
            executable = None
            total = 0
            for item in members:
                name = item.filename
                parts = pathlib.PurePosixPath(name)
                mode = item.external_attr >> 16
                receipt["members"].append(
                    {"name": name, "size": item.file_size, "mode": mode}
                )
                require(
                    not parts.is_absolute()
                    and ".." not in parts.parts
                    and "\\" not in name
                )
                require(name not in seen and not item.flag_bits & 1)
                seen.add(name)
                if item.is_dir():
                    require(name.rstrip("/") == "bun-linux-x64-baseline")
                    require(stat.S_IFMT(mode) in (0, stat.S_IFDIR))
                else:
                    require(name == "bun-linux-x64-baseline/bun")
                    require(stat.S_IFMT(mode) in (0, stat.S_IFREG))
                    require(executable is None)
                    executable = item
                total += item.file_size
                require(total <= 200_000_000)
                require(item.file_size <= max(1, item.compress_size) * 8)
            if executable is None:
                raise ValueError("Pinned archive contains no Bun executable")
            destination = root / "bin"
            destination.mkdir(mode=0o700)
            binary = destination / "bun"
            with package.open(executable) as src, binary.open("xb") as out:
                extracted = 0
                while chunk := src.read(65536):
                    require(time.monotonic() - started < 110)
                    extracted += len(chunk)
                    require(extracted <= executable.file_size)
                    out.write(chunk)
            require(extracted == executable.file_size)
            binary.chmod(0o700)
            receipt.update(
                executable=str(binary),
                executableBytes=extracted,
                executableSha256=hashlib.sha256(binary.read_bytes()).hexdigest(),
            )
        receipt["status"] = "passed"
    except Exception as error:
        receipt["error"] = {"name": type(error).__name__, "message": str(error)}
        raise
    finally:
        with (root / "setup-result.json").open("x") as out:
            out.write(json.dumps(receipt, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Bun setup failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
