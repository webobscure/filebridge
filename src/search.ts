import * as vscode from 'vscode';
import { Writable } from 'node:stream';
import { Connections, ReadSession } from './connections';
import { remotePath, SCHEME } from './model';
import { SearchFileTooLarge, SearchMatch, SearchOptions, SearchSource, SearchSummary, searchRemote } from './searchEngine';

export class FtpSearchSource implements SearchSource {
  private readonly readers: ReadSession[];
  private readonly cancellation: vscode.Disposable;
  private next = 0;
  private stopped = false;
  constructor(connections: Connections, id: string, private readonly token: vscode.CancellationToken, concurrency = 1) {
    this.readers = Array.from({ length: concurrency }, () => connections.openReadSession(id));
    this.cancellation = token.onCancellationRequested(() => this.stop());
    if (token.isCancellationRequested) this.stop();
  }
  stop(): void {
    this.stopped = true;
    for (const reader of this.readers) reader.dispose();
  }
  dispose(): void { this.stop(); this.cancellation.dispose(); }
  private run<T>(work: (client: import('basic-ftp').Client, root: string) => Promise<T>): Promise<T> {
    if (this.stopped || this.token.isCancellationRequested) return Promise.reject(new vscode.CancellationError());
    const reader = this.readers[this.next++ % this.readers.length];
    return reader.run(async (client, profile) => {
      if (this.stopped || this.token.isCancellationRequested) throw new vscode.CancellationError();
      return work(client, profile.rootPath);
    });
  }
  list(path: string) {
    return this.run(async (client, root) => (await client.list(remotePath(root, path))).map(entry => ({
      name: entry.name, directory: entry.isDirectory, link: entry.isSymbolicLink, size: entry.size
    })));
  }
  read(path: string, limit: number): Promise<Uint8Array> {
    return this.run(async (client, root) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const sink = new Writable({ write(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > limit) callback(new SearchFileTooLarge());
        else { chunks.push(Buffer.from(chunk)); callback(); }
      } });
      try { await client.downloadTo(sink, remotePath(root, path)); }
      catch (error) { if (size > limit) throw new SearchFileTooLarge(); throw error; }
      return Buffer.concat(chunks);
    });
  }
}

interface Hit extends SearchMatch { uri: vscode.Uri }
class FileResult extends vscode.TreeItem {
  readonly hits: Hit[] = [];
  constructor(readonly uri: vscode.Uri) {
    super(uri.path, vscode.TreeItemCollapsibleState.Expanded);
    this.resourceUri = uri; this.iconPath = vscode.ThemeIcon.File;
  }
}
type Result = FileResult | vscode.TreeItem;
export class SearchResults implements vscode.TreeDataProvider<Result>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly files = new Map<string, FileResult>();
  private status = 'Run FileBridge: Search Remote Files to search the server.';
  private heading?: vscode.TreeItem;
  private issues: string[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private active?: vscode.CancellationTokenSource;
  private running = false;
  getTreeItem(item: Result): vscode.TreeItem { return item; }
  getChildren(item?: Result): Result[] {
    if (item instanceof FileResult) return item.hits.map(hit => {
      const child = new vscode.TreeItem(`${hit.line + 1}:${hit.column + 1}  ${hit.preview}`);
      child.tooltip = `${hit.uri.path}:${hit.line + 1}:${hit.column + 1}`;
      child.command = { command: 'remoterfs.openSearchResult', title: 'Open Match', arguments: [hit] };
      return child;
    });
    const status = new vscode.TreeItem(this.status); status.tooltip = this.status;
    return [...(this.heading ? [this.heading] : []), status, ...this.files.values(), ...this.issues.map(issue => {
      const warning = new vscode.TreeItem(issue); warning.iconPath = new vscode.ThemeIcon('warning'); return warning;
    })];
  }
  cancel(): void { this.active?.cancel(); }
  async search(connections: Connections, id: string, path: string, name: string, options: SearchOptions): Promise<SearchSummary> {
    if (this.running) throw new Error('Cancel the current search before starting another.');
    const token = new vscode.CancellationTokenSource(); this.active = token; this.running = true;
    this.heading = new vscode.TreeItem(`“${options.query}” in ${name}:${path}`);
    this.heading.tooltip = `${options.caseSensitive ? 'Match case' : 'Ignore case'}\nFile types: ${options.extensions?.join(', ') || 'all'}\nSearch connections: ${options.concurrency ?? 1}\nExcluded: ${options.exclude.join(', ') || 'none'}\nMaximum file size: ${options.maxFileBytes / 1024 / 1024} MiB\nMaximum matches: ${options.maxResults}`;
    this.files.clear(); this.issues = []; this.status = `Searching ${name}: “${options.query}”…`; this.changed.fire();
    try {
      await vscode.commands.executeCommand('remoterfs.searchResults.focus');
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification,
        title: `FileBridge: Search ${name}`, cancellable: true }, async (progress, cancellation) => {
        const subscription = cancellation.onCancellationRequested(() => token.cancel());
        const source = new FtpSearchSource(connections, id, token.token, options.concurrency ?? 1);
        try {
          const summary = await searchRemote(source, path, options,
            () => token.token.isCancellationRequested, match => {
              const uri = vscode.Uri.from({ scheme: SCHEME, authority: id, path: match.path });
              let file = this.files.get(match.path);
              if (!file) { file = new FileResult(uri); this.files.set(match.path, file); }
              file.hits.push({ ...match, uri }); file.description = `${file.hits.length} ${file.hits.length === 1 ? 'match' : 'matches'}`;
              if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.changed.fire(); }, 150);
            }, (summary, file) => { progress.report({ message: `${summary.scanned} files · ${summary.matches} matches · ${file}` }); });
          const state = summary.cancelled ? 'Cancelled' : summary.limited ? 'Result limit reached' : summary.errors ? 'Finished with errors' : 'Finished';
          this.status = `${state}: ${summary.matches} ${summary.matches === 1 ? 'match' : 'matches'} in ${this.files.size} ${this.files.size === 1 ? 'file' : 'files'} · ${summary.scanned} searched · ` +
            `${summary.excluded} excluded · ${summary.binary} binary/non-UTF-8 · ${summary.large} too large · ${summary.links} links · ${summary.errors} errors`;
          this.issues = summary.issues;
          if (summary.limited) this.issues.unshift('Search stopped at the result limit. Narrow the query or increase filebridge.search.maxResults.');
          return summary;
        } finally { source.dispose(); subscription.dispose(); }
      });
    } catch (error) { this.status = 'Search failed. Run Search Remote Files to retry.'; throw error; }
    finally { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.active = undefined; this.running = false; token.dispose(); this.changed.fire(); }
  }
  dispose(): void { this.cancel(); if (this.timer) clearTimeout(this.timer); this.changed.dispose(); }
}

export async function openSearchResult(hit: Hit): Promise<void> {
  const start = new vscode.Position(hit.line, hit.column);
  await vscode.window.showTextDocument(hit.uri, { selection: new vscode.Range(start, start.translate(0, hit.length)) });
}
