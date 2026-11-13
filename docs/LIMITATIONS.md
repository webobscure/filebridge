# Supported behavior and limits

## Editors and protocols

| Capability | VS Code / Cursor | PhpStorm |
| --- | --- | --- |
| Desktop support | VS Code API 1.90 or later; Cursor builds supporting that API | Experimental plugin for PhpStorm 2026.2.x / build 262 |
| FTP and FTPS | Passive FTP, explicit FTPS, implicit FTPS | Same protocols |
| SFTP / SSH, active FTP, symbolic-link traversal | Unsupported | Unsupported |
| Save | Editor Save writes to the server; enabled editor Auto Save can also upload | Explicit Save uploads; normal IDE autosave does not upload |
| Content search | **FileBridge: Search Remote Files**, with clickable line results | **Search** in the FileBridge tool window |
| Standard Find in Files / project indexing | Does not search the full FTP server | Does not search the full FTP server |
| Local project synchronization | No full local project copy | Only opened files are cached outside the local project |
| Folder deletion | Recursive deletion supported by Explorer | Empty folders only |

The native plugin has transport tests and binary compatibility verification.
Manual browsing, save/failure/retry, and search/navigation checks passed in
licensed PhpStorm 2026.2.2 on macOS; see [the validation record](../jetbrains/VALIDATION.md).
The VS Code video and screenshots are explicitly demonstrations of that editor;
they do not establish native PhpStorm UI behavior.

## Search

Search reads server contents, including unopened UTF-8 files in the chosen
folder and its descendants. Unsaved local edits are not included. FTP has no
server-side content-search command, so candidate files are downloaded into
memory. Large projects and slower servers take longer. VS Code/Cursor uses up
to three dedicated search connections by default (configurable from 1 to 5),
plus the editor's connection. Some hosts require reducing this to 1. PhpStorm
currently searches one file at a time on its separate search connection.

- Literal, single-line text; optional case sensitivity. No regular expressions,
  multiline matching, or replace-all.
- Default limits: **10 MiB per file** and **1,000 matches**. Both editors allow
  up to 128 MiB and 50,000 matches through their respective search controls.
- Binary/non-UTF-8 files, symbolic links, and oversized files are counted as
  skipped. Unreadable paths are reported. Cancellation retains partial results.
- No default exclusions. Optional exclusions are exact names or relative paths,
  without wildcards. Editor exclusions and `.gitignore` do not control this search.
- VS Code/Cursor can filter downloads with `filebridge.search.extensions`, for
  example `[".php", ".js"]`. Empty includes all types. Concurrent results arrive
  in download order. Each in-flight download may use up to the per-file memory
  limit; cancellation and the result limit close search transports only.

VS Code files are loaded into memory for editing. Native PhpStorm editing is
limited to UTF-8 text files up to **32 MiB**, even if its search limit is higher.

## Saves and remote changes

Wizard-created connection profiles are kept in memory after this window's
successful writes to protect against late storage notifications in older
editors. Reload other open editor windows after changing wizard connections.

The default save mode uploads a temporary sibling file, then replaces the target
by rename. Servers must support that operation. Replacement may change file
permissions or ownership. On servers that refuse it, use `atomicSave: false`
for direct overwrite; a failed direct upload can leave partial contents.

External-change checks compare size and modification time. They are not file
locking and can miss same-size edits within timestamp precision or changes
immediately before replacement. There are no FTP push notifications: refresh
folders and reopen a file to load current server contents.

Failed saves are not replayed automatically. Keep unsaved edits and retry Save
after correcting the connection or permissions. PhpStorm also keeps an `.unsent`
recovery copy; see its README for recovery details.

Virtual remote folders do not provide a full remote development environment.
Git, terminals, builds, language-server indexing, and some AI extensions may
require a separate local project or another remote-development solution.

## Credentials and connection boundaries

Plain FTP sends credentials and file contents without encryption. FTPS validates
the certificate; FileBridge has no switch to disable that validation. Explicit
JSON passwords remain plain text; omitting the password enables secure storage.
Secure stores are separate between editors.

`rootPath` controls the displayed folder, while server permissions enforce actual
access. FileBridge does not replace server-side access controls or backups.
