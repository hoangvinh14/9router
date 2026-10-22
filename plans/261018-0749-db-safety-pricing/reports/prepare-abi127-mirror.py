import hashlib
import json
import os
import pathlib
import re
import shutil
import sys


def main():
    repo = pathlib.Path.cwd().resolve()
    root = pathlib.Path(sys.argv[1]).resolve(strict=True)
    assert root.parent == pathlib.Path("/tmp")
    assert root.name.startswith("9router-db-safety-abi127-")
    assert root.stat().st_uid == os.getuid()
    assert root.stat().st_mode & 0o077 == 0
    try:
        setup = json.loads((root / "setup-result.json").read_text())
    except (OSError, ValueError):
        raise
    assert setup["status"] == "passed"
    try:
        expected = json.loads(
            (
                repo
                / "plans/261018-0749-db-safety-pricing/reports/candidate-r3-source.json"
            ).read_text()
        )["files"]
    except (OSError, ValueError, KeyError):
        raise

    def sha(p):
        return hashlib.sha256(p.read_bytes()).hexdigest()

    for f, h in expected.items():
        assert sha(repo / f) == h, f
    mirror = root / "mirror"
    mirror.mkdir(mode=0o700)
    files = [
        repo / "package.json",
        repo / "src/lib/dataDir.js",
        repo / "src/shared/utils/keyAccess.js",
        repo / "src/shared/constants/keyAccess.js",
    ]
    files += list((repo / "src/lib/db").rglob("*.js"))
    for name in ["better-sqlite3", "bindings", "file-uri-to-path"]:
        package = repo / "node_modules" / name
        files += [package / "package.json"]
        files += (
            list((package / "lib").rglob("*.js"))
            if name == "better-sqlite3"
            else list(package.glob("*.js"))
        )
    manifest = {}
    imports = {}
    for src in sorted(set(files)):
        assert src.is_file() and not src.is_symlink()
        rel = src.relative_to(repo)
        dest = mirror / rel
        dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copyfile(src, dest)
        assert sha(src) == sha(dest)
        manifest[str(rel)] = sha(src)
        if src.suffix == ".js":
            imports[str(rel)] = re.findall(
                r'(?:from\s+|import\s*\(|require\s*\()\s*[\'"]([^\'"]+)',
                src.read_text(),
            )
    # No fallback engine package is copied. Any non-better selection must fail.
    binding = mirror / "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
    binding.parent.mkdir(parents=True, mode=0o700)
    shutil.copyfile(root / "unpack/better_sqlite3.node", binding)
    assert sha(binding) == setup["extractedSha256"]
    manifest[str(binding.relative_to(mirror))] = sha(binding)
    for directory in ["harness", "evidence", "fixtures"]:
        (root / directory).mkdir(mode=0o700)
    for directory in ["home", "data", "tmp", "cache"]:
        (root / "fixtures" / directory).mkdir(mode=0o700)
    (root / "mirror-manifest.json").write_text(
        json.dumps(
            {
                "files": manifest,
                "imports": imports,
                "copiedFrom": str(repo),
                "mirror": str(mirror),
                "loadedScope": "driver/migrations, better factory, pricing update/reset and key-access helpers; unused copied repos are not coverage",
                "originalBindingSha256": sha(
                    repo
                    / "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
                ),
            },
            indent=2,
        )
        + "\n"
    )
    print(
        "Prepared byte-identical private mirror:",
        len(manifest),
        "files; binding:",
        sha(binding),
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Mirror preparation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
