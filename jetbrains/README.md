# FileBridge for PhpStorm

Native IntelliJ Platform plugin by **Webobscure**. Browse FTP/FTPS folders in a
FileBridge tool window, open text files in the PhpStorm editor, and upload edits
with explicit **Save** (`Cmd+S` / `Ctrl+S`).

This native build targets **PhpStorm 2026.2.x**, including the installed
2026.2.2 build 262.10315.130. It is a separate ZIP plugin, not the VS Code VSIX.

## Install

1. In PhpStorm, open **Settings → Plugins**.
2. Open the gear menu and choose **Install Plugin from Disk…**.
3. Select `filebridge-phpstorm-0.2.0.zip` from the workspace root.
4. Restart the IDE if prompted.
5. Open **Settings → Tools → FileBridge** and paste your connection JSON.
6. Open **View → Tool Windows → FileBridge**, or use its right-side tool window button.

## Configure

The format matches FileBridge for VS Code and Cursor:

```json
{
  "remotefs.remote": {
    "my-server": {
      "name": "My Website",
      "scheme": "ftp",
      "host": "ftp.example.com",
      "port": 21,
      "username": "my-user",
      "rootPath": "/public_html",
      "atomicSave": true,
      "connectTimeout": 30000
    }
  }
}
```

Add `password` to use an explicit plain-text password, or leave it out, select
the server in FileBridge, and click **Password** to use the IDE's Password Safe.
Secrets stored by VS Code/Cursor are separate and must be entered in PhpStorm.

Supported `scheme` values: `ftp`, `ftps` (explicit TLS), `ftps-implicit`.
The default port is 21, or 990 for implicit FTPS. Any valid custom port, including
22220, is supported. `host` and `username` are required. `rootPath` defaults to
`/`, `connectTimeout` to 30000 ms, and `atomicSave` to `true`.

The settings editor accepts standard JSON. Copy the `remotefs.remote` object
from VS Code settings; JSONC comments and trailing commas are not part of this
plugin's documented configuration format. Configuration is stored locally in
the IDE's `filebridge.xml`, with settings roaming disabled.

## Work with files

Expand a server to load its folders. Double-click a file or press Enter to open
it in the editor. Its tab includes the server name. Use **Refresh**, **+ File**,
**+ Folder**, **Rename**, and **Delete** in the FileBridge toolbar.

Uploads happen on explicit Save. Normal IDE autosave does not upload remote
files. Wait for **Uploaded /path** before closing the project or exiting.
Operations run in a background queue per connection; network I/O does not run
on the editor thread.

During an upload, the document remains unsaved. A failed upload preserves the
unsaved document and writes a `.unsent` recovery copy beside the editor cache.
Reopening an existing remote file offers to restore these edits. Review them,
then save explicitly to retry. If the remote file was deleted or cannot be
downloaded, open the recovery copy manually from the IDE system directory under
`filebridge/<connection-id>/<path-hash>/<filename>.unsent`.

Only the files you open are cached, outside your local project, in the IDE
system directory. A full project copy is not downloaded or synchronized.

The default save mode uploads to a temporary sibling file and then renames it.
This protects the original if uploading fails, but requires server permission
to create temporary files and replace by rename. Replacement may change file
permissions or ownership. Set `atomicSave` to `false` for direct overwrite;
an interrupted direct upload can leave a partial file.

Size and modification time checks stop saves when the server version differs
from the opened version. These checks are not file locking: same-size changes
within timestamp precision and races immediately before rename may be missed.

## Current scope

- UTF-8 text files, up to 32 MiB; LF, CRLF, and UTF-8 BOM are preserved.
- Passive FTP and explicit/implicit FTPS. FTPS validates the certificate chain
  and hostname using the JVM trust store; certificate checks cannot be disabled.
- Empty folders can be deleted. Recursive deletion, SFTP, symbolic-link
  editing, and legacy filename encodings are not included.
- Save and close affected tabs before renaming or deleting a remote item.
- An editor cache is not a full remote project: project-wide analysis, Git, and
  builds may require a separate local project.

## Search remote files

Select a server or folder in FileBridge and click **Search**. Enter literal text,
optionally enable **Match case**, and press **Search**. Files are read recursively
from FTP/FTPS, including unopened files and hidden folders. Double-click a result
or press Enter to open the file at its matching line. The IDE's standard Find in
Files is separate and does not search the full FTP server.

The non-modal search window shows progress and has **Cancel Search**. Closing
the window also cancels its search. Cancellation during connection setup or a
stalled operation may take until its network timeout. Search uses a separate
FTP connection so it does not occupy the editor's upload queue.

No folders are excluded by default. Exclusions accept comma-separated exact
names anywhere or paths relative to the selected folder, such as
`node_modules, .git, storage/logs`; no wildcards. Default limits are 10 MiB per
file and 1,000 matches, adjustable in the window up to 128 MiB and 50,000 matches.
Editing files larger than 32 MiB remains unsupported even if a higher search
limit is chosen.

Search downloads candidate files into memory, one at a time. It reads server
contents, excluding unsaved editor changes, and does not populate the editor
cache or upload anything. Binary/non-UTF-8 files, links, and oversized files are
counted as skipped. Read errors, cancellation, and the result limit are shown
explicitly. Standard IDE exclusions and `.gitignore` do not apply to this search.

## Build and validate

```sh
python3 jetbrains/build.py
python3 jetbrains/test.py --transport-only
python3 jetbrains/test.py
```

The build script uses the installed PhpStorm 2026.2 SDK and bundled Java 25.
No system Java or Gradle installation is required. On macOS the default SDK is
`/Applications/PhpStorm.app/Contents`; set `PHPSTORM_HOME` for another location.
The pinned Apache Commons Net 3.13.0 JAR is downloaded from Maven Central if
absent, and its SHA-256 checksum is verified before compiling.

The test runner uses the existing temporary Python FTP fixture environment
at `/private/tmp/remoter-fs-test-venv`; set `REMOTER_TEST_PYTHON` to another
Python with `pyftpdlib` and `pyopenssl` installed.

Eleven Java transport checks passed against local FTP/FTPS servers: reading and
writing, Unicode filenames, file operations, conflict refusal, upload/rename
failure preservation, direct overwrite, permissions, TLS validation, and login
rejection, recursive search, hidden files, exclusions, limits, cancellation,
UTF-8 positions, and FTPS search. The native IDE test starter is included in test sources only.
Its isolated PhpStorm run currently stops with **No valid license found** before
executing editor-save checks. Compilation and transport tests do not establish
that the IDE UI, search dialog/navigation, and save hook have passed a full runtime test.

JetBrains Plugin Verifier **1.411**, run offline against **PS-262.10315.130**,
reports **Compatible**. The report is recorded in `jetbrains/VALIDATION.md`;
binary compatibility verification is separate from running the plugin in the IDE.

Relevant SDK documentation: [tool windows](https://plugins.jetbrains.com/docs/intellij/tool-windows.html),
[documents](https://plugins.jetbrains.com/docs/intellij/documents.html),
[password storage](https://plugins.jetbrains.com/docs/intellij/persisting-sensitive-data.html),
and [plugin compatibility](https://plugins.jetbrains.com/docs/intellij/verifying-plugin-compatibility.html).
