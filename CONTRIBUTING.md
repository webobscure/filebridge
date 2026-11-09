# Contributing to FileBridge

Report bugs at <https://github.com/webobscure/filebridge/issues>. Include the
editor version, operating system, FileBridge version, connection type, and steps
to reproduce. Use disposable test credentials in examples.

Use `feature/...` or `fix/...` branch names. Do not use `codex/...`. Consult the
official documentation when changing integrations or platform API usage.

## VS Code and Cursor

Use Node.js 22 and Python 3.12:

```sh
npm ci
python -m pip install -r test/requirements.txt
npm run check
npm test
npm run build
```

Integration tests exercise listing, reads, editor saves, search, cancellation,
failed uploads, conflicts, permissions, TLS validation, JSON settings, and
publisher migrations against disposable loopback FTP/FTPS servers.
The fixture uses replacement-capable rename semantics on every OS. Real servers
that refuse replacement by rename require FileBridge's documented direct save mode.

Set `REMOTER_TEST_PYTHON` to the Python executable with the fixture dependencies.
Set `REMOTER_TEST_VSCODE_VERSION=1.90.0` or `stable` to download and test an
isolated VS Code installation, then run `npm run test:integration`. The shortcut
`npm run test:minimum` selects 1.90.0. On Linux use
`xvfb-run -a npm run test:integration` in a headless environment.

Without a version selection, the runner uses the installed VS Code and Cursor
applications on macOS. Set `REMOTER_TEST_EDITOR` and `REMOTER_TEST_EXECUTABLE`
to test a specific installation. Normal editor profiles are never used.

Reports and editor logs are copied into `test-results/`. Reports record the
actual editor version, OS, architecture, Node runtime, and passed scenarios.
The fixture adds its own CA only to loopback TLS sockets in the test process;
this handles older Electron versions that ignore `NODE_EXTRA_CA_CERTS`.
Certificate and hostname verification stay enabled, and an untrusted certificate
must still be rejected. This test hook is excluded from the distributed VSIX.

## PhpStorm

See [the native plugin instructions](jetbrains/README.md). Local builds can use
an installed PhpStorm 2026.2 SDK. CI downloads the pinned 2026.2.2 Linux SDK and
Plugin Verifier with verified SHA-256 checksums, uses Java 25, runs the Java
transport suite, and checks binary compatibility. IDE UI/save-hook testing
requires a licensed PhpStorm and remains a separate manual check.

## Automation

Every branch push and pull request runs the VS Code integration suite on
Windows and Linux with both 1.90.0 and current stable, plus native plugin
build/transport/compatibility checks. Package assembly waits for all jobs to
succeed. Download `filebridge-release` from that workflow's artifacts.

To also check hosted macOS Intel, choose **Run workflow → Include hosted macOS
Intel checks** on the CI workflow page. Hosted macOS capacity can cause long
queues, so those jobs are opt-in. Local macOS/Apple Silicon runs use the same
suite; their reports include the actual editor and architecture.

Do not commit generated packages, SDKs, credentials, editor profiles, or test
reports. Use [the release procedure](RELEASING.md) to prepare a release.
