# FileBridge for PhpStorm 0.2.1 validation

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
Plugin com.webobscure.filebridge:0.2.1 against PS-262.10315.130: Compatible
Dynamic Plugin Eligibility:
    Plugin can probably be enabled or disabled without IDE restart
```

The full local report is under `jetbrains/build/verifier-offline/PS-262.10315.130/`.

## Runtime test limitation

A test-only ApplicationStarter was prepared to exercise native editor Save,
dirty-document retention after an upload failure, and explicit retry. It is not
included in the distributable plugin.

Launching it with isolated configuration, system, log, and plugin directories
stopped before executing the tests with:

```text
No valid license found
```

These editor integration checks, the search dialog/navigation, and visual UI inspection remain unverified.
No license files were copied and no license checks were bypassed. The user's
normal PhpStorm configuration was not used by the test runner.
