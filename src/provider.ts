// Virtual filesystem design adapted from liximomo/vscode-remote-fs (MIT).
import * as vscode from 'vscode';
import { Client, FileInfo, FTPError, FileType as FtpType } from 'basic-ftp';
import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { Connections } from './connections';
import { remotePath, SCHEME, ServerProfile } from './model';

function fileType(info: FileInfo): vscode.FileType {
  if (info.isSymbolicLink) { return vscode.FileType.SymbolicLink; }
  return info.isDirectory ? vscode.FileType.Directory : vscode.FileType.File;
}
function fileStat(info: FileInfo): vscode.FileStat {
  return { type: fileType(info), ctime: 0, mtime: info.modifiedAt?.getTime() ?? 0, size: info.size };
}
function fingerprint(info: FileInfo): string {
  return `${info.size}:${info.rawModifiedAt}:${info.modifiedAt?.getTime() ?? 0}`;
}

export class RemoteProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  private readonly versions = new Map<string, string>();
  constructor(private readonly connections: Connections) {}

  private async execute<T>(uri: vscode.Uri, work: (client: Client, path: string, profile: ServerProfile) => Promise<T>): Promise<T> {
    if (uri.scheme !== SCHEME) { throw vscode.FileSystemError.Unavailable('Unsupported URI scheme.'); }
    try {
      return await this.connections.run(uri.authority, (client, profile) => work(client, remotePath(profile.rootPath, uri.path), profile));
    } catch (error) {
      if (error instanceof vscode.FileSystemError) { throw error; }
      // FTP 550 is ambiguous (missing OR forbidden). Never infer that a file is absent from it.
      if (error instanceof FTPError && [450, 550, 553].includes(error.code)) {
        throw vscode.FileSystemError.NoPermissions(`FTP ${error.code}: the server rejected the operation on ${uri.path}. Check the path and permissions.`);
      }
      throw vscode.FileSystemError.Unavailable(`The operation on ${uri.path} did not complete. Check your connection and retry manually.`);
    }
  }

  private async entry(client: Client, path: string): Promise<FileInfo | undefined> {
    if (path === '/') {
      await client.cd('/');
      const root = new FileInfo('/');
      root.type = FtpType.Directory;
      return root;
    }
    const entries = await client.list(posix.dirname(path));
    return entries.find(entry => entry.name === posix.basename(path));
  }
  private async required(client: Client, path: string, uri: vscode.Uri): Promise<FileInfo> {
    const info = await this.entry(client, path);
    if (!info) { throw vscode.FileSystemError.FileNotFound(uri); }
    return info;
  }
  private rejectLink(info: FileInfo): void {
    if (info.isSymbolicLink) { throw vscode.FileSystemError.NoPermissions('Symbolic links are not supported yet.'); }
  }
  private changed(uri: vscode.Uri, type: vscode.FileChangeType): void {
    this.emitter.fire([{ uri, type }, { uri: uri.with({ path: posix.dirname(uri.path) }), type: vscode.FileChangeType.Changed }]);
  }
  private forbidRoot(uri: vscode.Uri): void {
    if (posix.normalize(uri.path) === '/') { throw vscode.FileSystemError.NoPermissions('The connection root cannot be deleted or renamed.'); }
  }
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    return this.execute(uri, async (client, path) => {
      if (uri.path === '/') {
        await client.cd(path);
        return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
      }
      return fileStat(await this.required(client, path, uri));
    });
  }
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    return this.execute(uri, async (client, path) => {
      if (uri.path === '/') { await client.cd(path); }
      else {
        const info = await this.required(client, path, uri);
        this.rejectLink(info);
        if (!info.isDirectory) { throw vscode.FileSystemError.FileNotADirectory(uri); }
      }
      return (await client.list(path))
        .filter(entry => entry.name !== '.' && entry.name !== '..' && !entry.name.includes('/'))
        .map(entry => [entry.name, fileType(entry)]);
    });
  }
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return this.execute(uri, async (client, path) => {
      const info = await this.required(client, path, uri);
      this.rejectLink(info);
      if (info.isDirectory) { throw vscode.FileSystemError.FileIsADirectory(uri); }
      const chunks: Buffer[] = [];
      const sink = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
      await client.downloadTo(sink, path);
      // Capture the listing from before downloading, so a concurrent change is not silently accepted.
      this.versions.set(uri.toString(), fingerprint(info));
      return Buffer.concat(chunks);
    });
  }
  async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): Promise<void> {
    await this.execute(uri, async (client, path, profile) => {
      this.forbidRoot(uri);
      const existing = await this.entry(client, path);
      if (!existing && !options.create) { throw vscode.FileSystemError.FileNotFound(uri); }
      if (existing && !options.overwrite) { throw vscode.FileSystemError.FileExists(uri); }
      if (existing?.isDirectory) { throw vscode.FileSystemError.FileIsADirectory(uri); }
      if (existing) { this.rejectLink(existing); }
      const version = this.versions.get(uri.toString());
      if (version !== undefined && (!existing || version !== fingerprint(existing))) {
        throw vscode.FileSystemError.NoPermissions('This file changed on the server. Copy your edits, reopen the file, and compare them with the latest version.');
      }
      const temporary = posix.join(posix.dirname(path), `.remoterfs-${randomUUID()}.tmp`);
      if (profile.atomicSave) {
        try {
          await client.uploadFrom(Readable.from([Buffer.from(content)]), temporary);
          const current = await this.entry(client, path);
          if ((existing && (!current || fingerprint(current) !== fingerprint(existing))) || (!existing && current)) {
            throw vscode.FileSystemError.NoPermissions('This file changed on the server during the upload. Reopen it and compare your edits.');
          }
          // Refuse to delete the original as a fallback if the server disallows replacement.
          await client.rename(temporary, path);
        } catch (error) {
          if (!client.closed) { await client.remove(temporary, true).catch(() => undefined); }
          throw error;
        }
      } else {
        await client.uploadFrom(Readable.from([Buffer.from(content)]), path);
      }
      // A metadata failure after successful upload must not report the save as failed.
      this.versions.delete(uri.toString());
      try {
        const saved = await this.entry(client, path);
        if (saved) { this.versions.set(uri.toString(), fingerprint(saved)); }
      } catch { /* Next read will establish a new baseline. */ }
      this.changed(uri, existing ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created);
    });
  }
  async createDirectory(uri: vscode.Uri): Promise<void> {
    await this.execute(uri, async (client, path) => {
      if (await this.entry(client, path)) { throw vscode.FileSystemError.FileExists(uri); }
      await client.send(`MKD ${path}`);
      this.changed(uri, vscode.FileChangeType.Created);
    });
  }
  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    this.forbidRoot(uri);
    await this.execute(uri, async (client, path) => {
      const info = await this.required(client, path, uri);
      this.rejectLink(info);
      if (info.isDirectory) {
        if (options.recursive) { await client.removeDir(path); }
        else { await client.send(`RMD ${path}`); }
      } else { await client.remove(path); }
      this.clearVersions(uri);
      this.changed(uri, vscode.FileChangeType.Deleted);
    });
  }
  async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
    this.forbidRoot(oldUri);
    this.forbidRoot(newUri);
    if (oldUri.authority !== newUri.authority || oldUri.scheme !== newUri.scheme) {
      throw vscode.FileSystemError.NoPermissions('Moving files between servers is not supported.');
    }
    await this.execute(oldUri, async (client, oldPath, profile) => {
      const newPath = remotePath(profile.rootPath, newUri.path);
      if (oldPath === newPath) { return; }
      const source = await this.required(client, oldPath, oldUri);
      this.rejectLink(source);
      const target = await this.entry(client, newPath);
      if (target && !options.overwrite) { throw vscode.FileSystemError.FileExists(newUri); }
      if (target) {
        this.rejectLink(target);
        if (source.isDirectory || target.isDirectory) {
          throw vscode.FileSystemError.NoPermissions('Replacing an existing folder is not supported.');
        }
      }
      await client.rename(oldPath, newPath);
      this.clearVersions(oldUri);
      this.clearVersions(newUri);
      this.changed(oldUri, vscode.FileChangeType.Deleted);
      this.changed(newUri, vscode.FileChangeType.Created);
    });
  }
  private clearVersions(uri: vscode.Uri): void {
    const prefix = uri.toString();
    for (const key of this.versions.keys()) {
      if (key === prefix || key.startsWith(`${prefix}/`)) { this.versions.delete(key); }
    }
  }
  refresh(uri: vscode.Uri): void { this.emitter.fire([{ uri, type: vscode.FileChangeType.Changed }]); }
  watch(): vscode.Disposable {
    // FTP has no push notifications. Explicit refresh reloads remote directory listings.
    return new vscode.Disposable(() => undefined);
  }
  dispose(): void { this.emitter.dispose(); this.versions.clear(); }
}
