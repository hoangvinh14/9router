# Pinned download and safe extraction only; no installation or execution.
import sys, os, json, pathlib, hashlib, urllib.request, urllib.parse, time, tarfile
root = pathlib.Path(sys.argv[1]).resolve(strict=True)
assert str(root).startswith('/tmp/9router-db-safety-abi127-')
assert root.stat().st_mode & 0o077 == 0
started = time.monotonic()
redirects = []
class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        assert u.scheme == 'https' and u.hostname in {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}
        assert not u.username and not u.password and len(redirects) < 4
        redirects.append({'host': u.hostname, 'path': u.path, 'status': code})
        return super().redirect_request(req, fp, code, msg, headers, newurl)
url = 'https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-node-v127-linux-x64.tar.gz'
expected = '94ce113ea2d9347fcd1cf8e46445cc271d1dbd02d05a64aa460442222f023b11'
receipt = {'status': 'failed', 'url': url, 'redirects': redirects, 'expectedSha256': expected}
try:
    (root / 'download').mkdir(mode=0o700)
    archive = root / 'download' / 'binding.tar.gz'
    with urllib.request.build_opener(Redirect()).open(urllib.request.Request(url, headers={'User-Agent': 'db-safety-pinned-artifact'}), timeout=20) as response:
        receipt['finalHost'] = urllib.parse.urlsplit(response.url).hostname
        receipt['finalPath'] = urllib.parse.urlsplit(response.url).path
        assert receipt['finalHost'] in {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}
        size = 0
        with archive.open('xb') as out:
            while True:
                assert time.monotonic() - started < 55
                chunk = response.read(65536)
                if not chunk: break
                size += len(chunk)
                assert size <= 2_000_000
                out.write(chunk)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    receipt.update(size=size, sha256=digest)
    assert size == 1089479 and digest == expected, 'Pinned archive mismatch'
    with tarfile.open(archive, 'r:gz') as tar:
        members = tar.getmembers()
        receipt['members'] = [{'name': m.name, 'size': m.size, 'type': str(m.type)} for m in members]
        files = []
        seen = set()
        for m in members:
            p = pathlib.PurePosixPath(m.name)
            assert not p.is_absolute() and '..' not in p.parts and m.name not in seen
            seen.add(m.name)
            if m.isdir():
                assert m.name.rstrip('/') in {'build', 'build/Release'}
            else:
                assert m.isfile() and m.name == 'build/Release/better_sqlite3.node'
                files.append(m)
        assert len(files) == 1 and 0 < files[0].size <= 16_000_000
        dest = root / 'unpack' / 'better_sqlite3.node'
        dest.parent.mkdir(mode=0o700)
        with tar.extractfile(files[0]) as source, dest.open('xb') as out:
            content = source.read(16_000_001)
            assert len(content) == files[0].size
            out.write(content)
        os.chmod(dest, 0o600)
        receipt['extractedSha256'] = hashlib.sha256(dest.read_bytes()).hexdigest()
        receipt['extractedBytes'] = len(content)
    receipt['status'] = 'passed'
except Exception as error:
    receipt['error'] = {'type': type(error).__name__, 'message': str(error)}
    raise
finally:
    (root / 'setup-result.json').write_text(json.dumps(receipt, indent=2) + '\n')
