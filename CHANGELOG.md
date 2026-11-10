# Changelog

## 0.7.1

- Preserve both sets of connections when importing concurrently in older editors, including VS Code 1.90 on Windows.
- Serialize wizard and migration profile writes, retaining successful saves when older storage notifications arrive late.
- Includes the parallel search and file-type filters introduced in 0.7.0.

## 0.7.0

- Search over up to three independent FTP/FTPS connections by default, configurable from one to five.
- Keep editor opening and saving on a separate connection from search; cancellation only closes search connections.
- Filter downloads by file extension, while keeping all file types and folders included by default.
- Close search connections on completion, cancellation, disconnect, or changed server settings.

## 0.6.1

- Add real screenshots, a short FTP workflow video, English listing copy, support links, and detailed upgrade/limitations guides.
- Add the public repository, bug reporting, cross-platform CI, and automated release packages with checksums.
- Test VS Code 1.90.0 and current stable on Windows/Linux; support optional hosted macOS checks.
- Preserve connections saved while migration is waiting for secure password storage.
- Make FTP failure fixtures portable and isolate injected faults from background editor scans.
- Refresh Explorer after reconnecting and polish singular search result labels.

## 0.6.0

- Search UTF-8 file contents recursively over FTP/FTPS, including unopened files and hidden folders.
- Add FileBridge Search results grouped by file, with line/column navigation, progress, and cancellation.
- Support case-sensitive searches, explicit exclusions, configurable file size and result limits.
- Report skipped files, incomplete searches, and read errors without modifying server files or caching the project.
- Exclude native PhpStorm ZIP packages from the VSIX.

## 0.5.0

- Change the publisher to Webobscure and the extension identifier to `Webobscure.filebridge`.
- Provide migration helpers for both previous publisher identities.
- Give helpers separate commands and track completed transfers per destination publisher.

## 0.4.0

- Change the publisher to FileBridge and the extension identifier to `FileBridge.filebridge`.
- Add a one-time helper to transfer wizard connections and secure passwords from the legacy extension without exporting secrets to files.
- Keep `remotefs.remote`, command IDs, and remote folder URIs compatible.
- Document upgrade steps for the new extension identity.

## 0.3.0

- Rename the extension to FileBridge across Explorer, commands, prompts, and documentation.
- Introduce a folder-and-bridge logo, combining remote files and the connection between editor and server.
- Retain the extension identifier, internal command IDs, URI scheme, and `remotefs.remote` settings for existing installations.

## 0.2.3

- Clean up translucent artifacts in the icon's blue background, especially on light backgrounds.
- Preserve the folder and transfer arrows design.

## 0.2.2

- Add a blue folder and transfer arrows logo to the extension listing and details page.
- Clarify how to update an existing VSIX installation and verify the installed version.

## 0.2.1

- Rewrite the extension description and README in English, with a clearer setup guide, connection options, and command reference.
- Translate command names, connection prompts, settings descriptions, and error messages into English.
- Add a direct link to JSON settings from the empty server list.

## 0.2.0

- Support `remotefs.remote` in settings.json using the original Remote FS FTP configuration format.
- Add configuration suggestions, validation, and live server list updates.
- Support JSON passwords or SecretStorage, with reauthentication after password changes.
- Prevent host, port, username, or root changes from redirecting existing open files.
- Verify JSON configuration and connections in VS Code and Cursor.

## 0.1.0

- Open FTP/FTPS folders through a virtual filesystem provider.
- Add a connection wizard and server list in Explorer.
- Store passwords in SecretStorage and serialize operations per server.
- Save through temporary upload and rename, or direct overwrite.
- Check for external changes and report write failures to the editor.
- Create, rename, and delete files and folders.
- Verify editing workflows in VS Code and Cursor with local FTP/FTPS fixtures.
