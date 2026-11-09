import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { SCHEME, ServerProfile, validText, remotePath, SerialQueue } from './model';
import { Profiles } from './profiles';
import { Connections } from './connections';
import { RemoteProvider } from './provider';
import { importLegacyState, MigrationTarget } from './migration';
import { SearchResults, openSearchResult } from './search';
import { SearchOptions, validateSearch } from './searchEngine';

function rootUri(profile: ServerProfile): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, authority: profile.id, path: '/' });
}
class ServerItem extends vscode.TreeItem {
  constructor(readonly profile: ServerProfile) {
    super(profile.name, vscode.TreeItemCollapsibleState.None);
    this.id = profile.id;
    this.contextValue = 'server';
    this.description = `${profile.protocol} · ${profile.host}:${profile.port}${profile.configKey !== undefined ? ' · settings.json' : ''}`;
    this.tooltip = `${profile.username}@${profile.host}:${profile.port}${profile.rootPath}`;
    this.iconPath = new vscode.ThemeIcon('server');
    this.command = { command: 'remoterfs.connect', title: 'Connect', arguments: [this] };
  }
}
class ServerTree implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private readonly profiles: Profiles) {}
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(): vscode.TreeItem[] {
    const errors = this.profiles.configurationErrors().map(message => {
      const item = new vscode.TreeItem(message);
      item.iconPath = new vscode.ThemeIcon('warning');
      item.tooltip = message;
      item.command = { command: 'remoterfs.openSettings', title: 'Open Settings' };
      return item;
    });
    return [...this.profiles.list().map(profile => new ServerItem(profile)), ...errors];
  }
  refresh(): void { this.emitter.fire(); }
  dispose(): void { this.emitter.dispose(); }
}

async function input(title: string, value = '', validate?: (value: string) => string | undefined): Promise<string | undefined> {
  return vscode.window.showInputBox({ title, value, ignoreFocusOut: true,
    validateInput: validate ?? (text => validText(text.trim()) ? undefined : 'Enter a value without control characters.') });
}

export function activate(context: vscode.ExtensionContext): MigrationTarget {
  const profiles = new Profiles(context);
  const connections = new Connections(profiles);
  const provider = new RemoteProvider(connections);
  const tree = new ServerTree(profiles);
  const search = new SearchResults();
  const migrationQueue = new SerialQueue();
  context.subscriptions.push(connections, provider, tree, search,
    vscode.workspace.registerFileSystemProvider(SCHEME, provider, { isCaseSensitive: true }),
    vscode.window.registerTreeDataProvider('remoterfs.servers', tree),
    vscode.window.registerTreeDataProvider('remoterfs.searchResults', search),
    vscode.commands.registerCommand('remoterfs.cancelSearch', () => search.cancel()),
    vscode.commands.registerCommand('remoterfs.openSearchResult', openSearchResult));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('remotefs.remote')) {
      tree.refresh();
      void connections.prune().catch(() => undefined);
    }
  }));

  function command(name: string, handler: (item?: ServerItem) => Promise<unknown>): void {
    context.subscriptions.push(vscode.commands.registerCommand(`remoterfs.${name}`, async (item?: ServerItem) => {
      try { return await handler(item); }
      catch (error) { await vscode.window.showErrorMessage(`FileBridge: ${error instanceof Error ? error.message : 'The operation did not complete.'}`); }
    }));
  }
  command('openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettingsJson');
  });
  async function choose(item?: ServerItem): Promise<ServerProfile | undefined> {
    if (item?.profile?.id) { return profiles.get(item.profile.id); }
    const selected = await vscode.window.showQuickPick(profiles.list().map(profile => ({
      label: profile.name, description: `${profile.protocol}://${profile.host}:${profile.port}${profile.rootPath}`, profile
    })), { placeHolder: 'Select a server' });
    return selected?.profile;
  }
  async function connect(profile: ServerProfile): Promise<void> {
    connections.enable(profile.id);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `FileBridge: ${profile.name}` },
      () => provider.readDirectory(rootUri(profile)));
    const uri = rootUri(profile);
    if (!(vscode.workspace.workspaceFolders ?? []).some(folder => folder.uri.toString() === uri.toString())) {
      const added = vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0,
        { uri, name: `${profile.name} (FTP${profile.protocol === 'ftp' ? '' : 'S'})` });
      if (!added) { throw new Error('Could not add the folder to your workspace. Try connecting again.'); }
    }
    await vscode.commands.executeCommand('workbench.view.explorer');
  }

  context.subscriptions.push(vscode.commands.registerCommand('remoterfs.search', async (
    target?: ServerItem | vscode.Uri, supplied?: Partial<SearchOptions>) => {
    try {
      const uri = target instanceof vscode.Uri && target.scheme === SCHEME ? target : undefined;
      const profile = uri ? profiles.get(uri.authority) : await choose(target instanceof ServerItem ? target : undefined);
      if (!profile) return;
      let path = uri?.path ?? '/';
      if (uri && (await provider.stat(uri)).type !== vscode.FileType.Directory) path = path.slice(0, path.lastIndexOf('/')) || '/';
      const query = supplied?.query ?? await vscode.window.showInputBox({ title: `Search remote files: ${profile.name}${path}`,
        prompt: 'Text to find in all UTF-8 files, including files you have not opened', ignoreFocusOut: true,
        validateInput: value => !value.length || value.length > 1024 || /[\r\n\0]/.test(value) ? 'Enter 1–1024 characters on one line.' : undefined });
      if (query === undefined) return;
      const mode = supplied?.caseSensitive === undefined ? await vscode.window.showQuickPick([
        { label: 'Ignore case', value: false }, { label: 'Match case', value: true }
      ], { title: 'FileBridge: Search options', ignoreFocusOut: true }) : { value: supplied.caseSensitive };
      if (!mode) return;
      const config = vscode.workspace.getConfiguration('filebridge.search', uri);
      const options: SearchOptions = { query, caseSensitive: mode.value,
        exclude: supplied?.exclude ?? config.get<string[]>('exclude', []),
        maxFileBytes: supplied?.maxFileBytes ?? config.get<number>('maxFileSizeMB', 10) * 1024 * 1024,
        maxResults: supplied?.maxResults ?? config.get<number>('maxResults', 1000) };
      validateSearch(options);
      connections.enable(profile.id);
      return await search.search(connections, profile.id, path, profile.name, options);
    } catch (error) {
      void vscode.window.showErrorMessage(`FileBridge: ${error instanceof Error ? error.message : 'Search failed.'}`);
      if (supplied) throw error;
    }
  }));

  command('addServer', async () => {
    const name = await input('Server name'); if (name === undefined) { return; }
    const protocol = await vscode.window.showQuickPick([
      { label: 'FTPS — explicit TLS', description: 'Encrypted connection, usually port 21', value: 'ftps' as const },
      { label: 'FTP', description: 'Unencrypted connection, usually port 21', value: 'ftp' as const },
      { label: 'FTPS — implicit TLS', description: 'Encrypted connection, usually port 990', value: 'ftps-implicit' as const }
    ], { title: 'Connection protocol', ignoreFocusOut: true });
    if (!protocol) { return; }
    const host = await input('Server hostname or IP address', '', value =>
      validText(value.trim()) && !/[\s/@]/.test(value.trim()) ? undefined : 'Enter a hostname or IP address without a protocol prefix or path.');
    if (host === undefined) { return; }
    const port = await input('Port', protocol.value === 'ftps-implicit' ? '990' : '21', value =>
      /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535 ? undefined : 'Enter a port between 1 and 65535.');
    if (port === undefined) { return; }
    const username = await input('Username'); if (username === undefined) { return; }
    const rootPath = await input('Remote folder (for example, /public_html)', '/', value => {
      try { remotePath(value, '/'); return undefined; }
      catch (error) { return (error as Error).message; }
    });
    if (rootPath === undefined) { return; }
    const mode = await vscode.window.showQuickPick([
      { label: 'Upload to a temporary file, then rename', description: 'Preserves the original if the upload fails. File permissions may change.', atomic: true },
      { label: 'Overwrite directly', description: 'For servers that cannot replace files by renaming. Failed uploads may leave partial files.', atomic: false }
    ], { title: 'How should files be saved?', ignoreFocusOut: true });
    if (!mode) { return; }
    const password = await vscode.window.showInputBox({ title: 'Password (saved in the editor’s secure storage)', password: true, ignoreFocusOut: true,
      validateInput: value => /[\r\n\0]/.test(value) ? 'The password must not contain control characters.' : undefined });
    if (password === undefined) { return; }
    const profile: ServerProfile = { id: randomUUID(), name: name.trim(), host: host.trim(), port: Number(port),
      username: username.trim(), protocol: protocol.value, rootPath, timeout: 30000, atomicSave: mode.atomic };
    await profiles.add(profile, password);
    tree.refresh();
    await connect(profile);
  });
  command('connect', async item => {
    if (profiles.list().length === 0) { return vscode.commands.executeCommand('remoterfs.addServer'); }
    const profile = await choose(item);
    if (profile) { await connect(profile); }
  });
  command('disconnect', async item => {
    const profile = await choose(item); if (!profile) { return; }
    await connections.disconnect(profile.id);
    void vscode.window.showInformationMessage(`FileBridge: ${profile.name} disconnected. The folder remains in Explorer so you can reconnect.`);
  });
  command('refresh', async () => {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme === SCHEME) { provider.refresh(folder.uri); }
    }
    tree.refresh();
    await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
  });
  command('changePassword', async item => {
    const profile = await choose(item); if (!profile) { return; }
    if (profiles.hasConfiguredPassword(profile.id)) {
      void vscode.window.showInformationMessage('This password is set in remotefs.remote. Edit the password field, or remove it to use secure storage.');
      await vscode.commands.executeCommand('remoterfs.openSettings');
      return;
    }
    const password = await vscode.window.showInputBox({ title: `New password for ${profile.name}`, password: true, ignoreFocusOut: true,
      validateInput: value => /[\r\n\0]/.test(value) ? 'The password must not contain control characters.' : undefined });
    if (password === undefined) { return; }
    await connections.disconnect(profile.id);
    await profiles.setPassword(profile.id, password);
    connections.enable(profile.id);
  });
  command('removeServer', async item => {
    const profile = await choose(item); if (!profile) { return; }
    if (profile.configKey !== undefined) {
      void vscode.window.showInformationMessage(`To remove this connection, delete "${profile.configKey}" from remotefs.remote in Settings.`);
      await vscode.commands.executeCommand('remoterfs.openSettings');
      return;
    }
    if (vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === SCHEME && document.uri.authority === profile.id)) {
      throw new Error('Save or close the modified files from this server first.');
    }
    const answer = await vscode.window.showWarningMessage(`Remove the connection "${profile.name}" and its saved password?`,
      { modal: true, detail: 'Files on the server will be kept.' }, 'Remove Connection');
    if (answer !== 'Remove Connection') { return; }
    await connections.disconnect(profile.id);
    await profiles.remove(profile.id);
    tree.refresh();
    // One workspace update avoids using stale indices and survives an extension host restart.
    const folders = vscode.workspace.workspaceFolders ?? [];
    const kept = folders.filter(folder => folder.uri.scheme !== SCHEME || folder.uri.authority !== profile.id);
    if (kept.length !== folders.length) {
      vscode.workspace.updateWorkspaceFolders(0, folders.length, ...kept.map(folder => ({ uri: folder.uri, name: folder.name })));
    }
  });
  return { importLegacyState: state => migrationQueue.run(async () => {
    await importLegacyState(context, state);
    tree.refresh();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme === SCHEME) { provider.refresh(folder.uri); }
    }
  }) };
}
