"""Download the pinned Linux x64 SDK and Plugin Verifier from their official publishers."""
import hashlib
import os
from pathlib import Path
import tarfile
import urllib.request

root = Path(__file__).resolve().parent.parent
tools = root / '.tools'
tools.mkdir(exist_ok=True)

def download(url, path, expected):
    if not path.exists() or hashlib.file_digest(path.open('rb'), 'sha256').hexdigest() != expected:
        print('Downloading', url, flush=True)
        urllib.request.urlretrieve(url, path)
    with path.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != expected:
        path.unlink()
        raise SystemExit('SHA-256 mismatch: ' + url)

sdk = tools / 'phpstorm-2026.2.2'
if not (sdk / 'product-info.json').exists():
    archive = tools / 'phpstorm.tar.gz'
    download('https://download.jetbrains.com/webide/PhpStorm-2026.2.2.tar.gz', archive,
             '6410c62a9a03cdc62ee78a7ebf5a3e5085314a9121e775f358a3531295627728')
    extraction = tools / 'sdk-extract'
    extraction.mkdir(exist_ok=True)
    with tarfile.open(archive) as tar:
        tar.extractall(extraction, filter='data')
    candidates = list(extraction.glob('*/product-info.json'))
    if len(candidates) != 1:
        raise SystemExit('Unexpected PhpStorm SDK layout.')
    candidates[0].parent.rename(sdk)
    archive.unlink()

download('https://repo.maven.apache.org/maven2/org/jetbrains/intellij/plugins/verifier-cli/1.411/verifier-cli-1.411-all.jar',
         tools / 'verifier.jar', 'd6cc1c1f17761bb5efff187f98b63fb792c7ef2a2fb9202bb5dbea05ebc02bfa')
print('PHPSTORM_HOME=' + str(sdk))
if os.environ.get('GITHUB_ENV'):
    with open(os.environ['GITHUB_ENV'], 'a') as env:
        env.write('PHPSTORM_HOME=' + str(sdk) + '\n')
