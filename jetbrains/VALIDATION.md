# FileBridge for PhpStorm 0.2.2 validation

Checked November 13, 2026. The transport and manual IDE checks used 0.2.1.
Version 0.2.2 changes release metadata and documentation only; all of its Java
class bytes match the tested ZIP. ZIP integrity, embedded description, version,
vendor, change notes, separate dependency JAR, and absence of test classes were
checked. Release ZIP SHA-256:
`e6eacaebb209bbe52e8649d037f2d5a95f891f25041557fdef2ab2a0926080a7`.

## Target and build

- PhpStorm 2026.2.2, build PS-262.10315.130.
- Compiled with the IDE's bundled JBR 25.0.4 and installed IntelliJ Platform SDK.
- Apache Commons Net 3.13.0, pinned SHA-256:
  `9e88444afadc9467f0bf3d328f93b9538da35a9be05cdee430766e64fddbd6c5`.
- Plugin ID: `com.webobscure.filebridge`; vendor: `Webobscure`.

## Java transport integration: 11 passed

Tests used loopback-only pyftpdlib servers and disposable fixture data.

1. Legacy JSON fields, defaults, and path validation.
2. Directory listing, reading, atomic upload, and verification of server bytes.
3. Unicode, spaces, percent signs, and hashes in filenames.
4. Creating, renaming, deleting, and refusing nonempty directory deletion.
5. Refusing to overwrite a remote file changed by another client.
6. Preserving the original after rejected upload or rename and cleaning temporary files.
7. Direct overwrite and read-only account permissions.
8. FTPS with a trusted certificate, rejecting an untrusted certificate, and login rejection.
9. Recursive remote search, hidden and unopened files, exclusions, binary/encoding/size/link skips, and UTF-16 editor positions.
10. Search limits, partial results on cancellation, unreadable folder reporting, and bounded downloads.
11. Remote content search over trusted FTPS.

## Binary compatibility

JetBrains Plugin Verifier 1.411, offline, against the installed PhpStorm:

```text
Plugin com.webobscure.filebridge:0.2.2 against PS-262.10315.130: Compatible
Dynamic Plugin Eligibility:
    Plugin can probably be enabled or disabled without IDE restart
```

The full local report is under `test-results/plugin-verifier/PS-262.10315.130/`.

## Manual IDE checks: passed

The clean distribution ZIP was installed through **Install Plugin from Disk**
in the user's licensed PhpStorm. FileBridge became available without restarting
the IDE. Checks used a separate disposable `demo-project` window and an FTP
server bound only to `127.0.0.1`; no existing server profiles were changed.

- Added the familiar `remotefs.remote` JSON configuration to an empty FileBridge
  configuration and expanded the server to browse `index.php` and `src`.
- Opened remote `index.php`, edited it, and pressed Cmd+S. The IDE showed
  **Uploaded /index.php**; reading the fixture file independently confirmed the
  changed server bytes.
- Searched for `bridge-search-check` in the previously unopened `src/config.php`.
  The search reported one match, two files searched, and zero errors. Opening
  the result placed the editor caret at **5:25**.
- Rejected STOR in the FTP fixture. Explicit Save showed **Upload failed**,
  preserved the original server bytes, and wrote the changed text to `.unsent`.
  Removed the rejection and pressed Cmd+S again: the upload succeeded and the
  server contained the retained edits.
- Edited the file again and switched tabs without saving explicitly. The server
  bytes stayed unchanged. A subsequent Cmd+S uploaded the new text.

The first edit of a cached remote file triggered PhpStorm's **Non-Project Files
Protection** dialog. Only **This file** was allowed. Users may encounter the
same prompt; the plugin does not disable protection for other files.

Genuine captures are in `docs/media/jetbrains/`. They show the disposable IDE
window, not the user's working project. The single-row toolbar can require a
wider tool window to reveal all actions.

## Runtime test limitation

A test-only ApplicationStarter was prepared to exercise native editor Save,
dirty-document retention after an upload failure, and explicit retry. It is not
included in the distributable plugin.

Launching it with isolated configuration, system, log, and plugin directories
stopped before executing the tests with:

```text
No valid license found
```

The automated IDE starter remains unexecuted. The manual checks above establish
the listed save, failure/retry, search/navigation, and UI behavior on this target;
they do not establish runtime compatibility with other IDEs or operating systems.
No license files were copied and no license checks were bypassed. The user's
normal PhpStorm configuration was not used by the test runner.
