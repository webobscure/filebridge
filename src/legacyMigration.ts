import * as vscode from 'vscode';
import { ServerProfile, validateProfile } from './model';
import { parseRemotes } from './settings';
import { FILEBRIDGE_EXTENSION_ID, MigrationTarget, migrationCommandId } from './migration';

export function activate(context: vscode.ExtensionContext): void {
  const completedKey = `migrationComplete:${FILEBRIDGE_EXTENSION_ID}`;
  const commandId = migrationCommandId(context.extension.id);
  let running: Promise<void> | undefined;
  async function transfer(): Promise<void> {
    const target = vscode.extensions.getExtension<MigrationTarget>(FILEBRIDGE_EXTENSION_ID);
    if (!target) { throw new Error('Install FileBridge by Webobscure (0.5.0 or later), then run this command again.'); }
    const servers = context.globalState.get<ServerProfile[]>('servers', []);
    servers.forEach(validateProfile);
    const configured = parseRemotes(vscode.workspace.getConfiguration('remotefs').get<unknown>('remote', {}));
    const ids = new Set([...servers, ...configured.profiles].map(profile => profile.id));
    const passwords: { id: string; password: string }[] = [];
    for (const id of ids) {
      const password = await context.secrets.get(`password:${id}`);
      if (password !== undefined) { passwords.push({ id, password }); }
    }
    const api = await target.activate();
    if (typeof api?.importLegacyState !== 'function') { throw new Error('Update FileBridge before transferring connections.'); }
    await api.importLegacyState({ servers, passwords });
    await context.globalState.update(completedKey, true);
    void vscode.window.showInformationMessage('FileBridge: Connections and saved passwords transferred. You can now uninstall FileBridge Migration Helper.');
  }
  function migrate(): Promise<void> {
    if (!running) { running = transfer().finally(() => { running = undefined; }); }
    return running;
  }
  context.subscriptions.push(vscode.commands.registerCommand(commandId, async () => {
    try { await migrate(); }
    catch { void vscode.window.showErrorMessage('FileBridge: Transfer did not finish. Keep Migration Helper installed, check that FileBridge is installed and enabled, then run "FileBridge: Transfer Legacy Connections" again.'); }
  }));
  if (!context.globalState.get(completedKey, false) && vscode.extensions.getExtension(FILEBRIDGE_EXTENSION_ID)) {
    void migrate().catch(() => {
      void vscode.window.showErrorMessage('FileBridge: Automatic transfer did not finish. Run "FileBridge: Transfer Legacy Connections" to retry.');
    });
  }
}
