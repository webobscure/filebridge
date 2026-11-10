# Upgrade to FileBridge

Save or copy any unsaved remote edits before changing extensions. Install the
current FileBridge by **Webobscure** from your editor's catalog, or download the
main `filebridge-<version>.vsix` from the [latest GitHub Release](https://github.com/webobscure/filebridge/releases/latest)
and use **Extensions → … → Install from VSIX…**. Reload when prompted.

## Choose your previous extension

| Previous identifier / publisher | What to do |
| --- | --- |
| `Webobscure.filebridge`, version 0.5.0 or later | Update from the editor's catalog or install the newer VSIX. Connections, secure passwords, and remote URIs use the same identity. No helper is needed. |
| `FileBridge.filebridge`, version 0.4.0 | Use `filebridge-migration-from-0.4-0.4.1.vsix`, then install the current FileBridge. |
| `remoter-fs-local.remoter-fs`, through 0.3.0 | Use `filebridge-migration-from-remoter-0.3.2.vsix`, then install the current FileBridge. |
| Original `liximomo.remotefs` | Reuse supported FTP entries from `remotefs.remote`; see the dedicated instructions below. The FileBridge migration helpers do not target this extension. |

The display name alone is not enough to choose a helper. Open the extension's
details page and check its publisher or identifier.

## If your connections are entirely in settings.json

For earlier FileBridge/Remoter FS publishers, disable the old extension, install
the current FileBridge, and reload. Existing supported `remotefs.remote` entries
are read directly. A JSON password takes precedence over secure storage.

If a JSON connection omits `password` but previously used secure storage under
another publisher, use the matching helper below or run **FileBridge: Change
Password** once after upgrading.

## Keep wizard connections and securely saved passwords

1. Save your remote edits.
2. Install the matching helper from the table above. It replaces its matching
   old extension and reads that extension's local connection/password storage.
3. Install the current FileBridge and reload the editor.
4. Wait for **Connections and saved passwords transferred**. To retry, run
   **FileBridge: Transfer Legacy Connections**, choosing the command with the
   matching source publisher.
5. Open a migrated connection and confirm you can read a file.
6. Uninstall the migration helper after success. Keep only the current FileBridge
   filesystem extension enabled.

The helpers transfer secrets directly between extension contexts. They do not
export passwords to files or send them to a network service. Repeating an import
keeps newer FileBridge profiles and passwords. Old data remains in the helper's
storage until you uninstall it.

## From the original Remote FS by liximomo

The original extension is `liximomo.remotefs`; its configuration format is
documented in [the original source](https://github.com/liximomo/vscode-remote-fs/blob/master/package.json).

1. Save your edits and preserve your connection settings.
2. Disable the original extension.
3. Install FileBridge. Keep the supported FTP fields under `remotefs.remote`:
   `name`, `scheme`, `host`, `port`, `username`, `password`, `rootPath`, and
   `connectTimeout`. Remove unsupported SSH/SFTP fields from FTP entries.
4. Set the FTP port explicitly. FileBridge defaults to 21; do not assume an
   implicit port from the old extension. For TLS, choose `ftps` (explicit) or
   `ftps-implicit` and use the port provided by your server administrator.
5. Connect through the FileBridge server list. Existing original `ftp://` or
   `sftp://` workspace folders and tabs are not converted to FileBridge's URIs.
   Close those saved tabs and remove the old workspace folder entries.

SFTP/SSH connections are not supported by FileBridge. The helpers for FileBridge's
own previous publishers do not import the original extension's private storage.
To use secure password storage, omit `password` from JSON and run **FileBridge:
Change Password** after adding the connection.

## Moving between editors

VS Code, Cursor, and PhpStorm have separate secure stores. Copy supported JSON
connection details and enter the password separately in the destination editor.
PhpStorm accepts standard JSON, without JSONC comments or trailing commas, in
**Settings → Tools → FileBridge**. Its native ZIP is installed separately.

If an upgrade fails, keep your unsaved edits, leave the helper installed, and
[open a support issue](https://github.com/webobscure/filebridge/issues/new/choose)
with editor/version details and the step that failed. Omit passwords from reports.
