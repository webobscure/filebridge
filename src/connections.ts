import { Client, FTPError } from 'basic-ftp';
import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { SerialQueue, ServerProfile } from './model';
import { Profiles } from './profiles';

interface Session { client: Client; queue: SerialQueue; signature?: string }
export class Connections implements vscode.Disposable {
  private readonly sessions = new Map<string, Session>();
  private readonly blocked = new Set<string>();
  private disposed = false;
  constructor(private readonly profiles: Profiles) {}

  enable(id: string): void { this.blocked.delete(id); }

  run<T>(id: string, operation: (client: Client, profile: ServerProfile) => Promise<T>): Promise<T> {
    if (this.disposed || this.blocked.has(id)) {
      return Promise.reject(vscode.FileSystemError.Unavailable('The server is disconnected. Run "FileBridge: Connect".'));
    }
    let session = this.sessions.get(id);
    if (!session) {
      const profile = this.profiles.get(id);
      session = { client: new Client(profile.timeout), queue: new SerialQueue() };
      this.sessions.set(id, session);
    }
    const current = session;
    return current.queue.run(async () => {
      if (this.disposed || this.blocked.has(id)) {
        throw vscode.FileSystemError.Unavailable('The server is disconnected.');
      }
      const profile = this.profiles.get(id);
      const password = await this.profiles.password(id);
      const signature = createHash('sha256').update(JSON.stringify([profile, password])).digest('hex');
      if (current.signature !== signature) {
        current.client.close();
        current.client = new Client(profile.timeout);
      }
      if (current.client.closed) {
        try {
          await current.client.access({
            host: profile.host, port: profile.port, user: profile.username,
            password,
            secure: profile.protocol === 'ftp' ? false : profile.protocol === 'ftps' ? true : 'implicit',
            secureOptions: { rejectUnauthorized: true }
          });
          current.signature = signature;
        } catch (error) {
          current.client.close();
          if (error instanceof FTPError && error.code === 530) {
            throw vscode.FileSystemError.NoPermissions('The server rejected the login. Check your username and password.');
          }
          throw vscode.FileSystemError.Unavailable('Could not connect. Check the hostname, port, FTP/FTPS mode, and server certificate.');
        }
      }
      // Failed writes are never replayed. A closed connection is reopened on the next request.
      return operation(current.client, profile);
    });
  }

  async prune(): Promise<void> {
    const ids = new Set(this.profiles.list().map(profile => profile.id));
    // Configuration removal retires the transport, not the user's ability to restore that entry.
    // Keep its queue so a rapid remove/re-add cannot create parallel queues for one URI.
    await Promise.all([...this.sessions.entries()].filter(([id]) => !ids.has(id)).map(([, session]) =>
      session.queue.run(async () => { session.client.close(); })));
  }

  async disconnect(id: string): Promise<void> {
    this.blocked.add(id);
    const session = this.sessions.get(id);
    if (session) {
      // Wait for an active save to finish before closing its transport.
      await session.queue.run(async () => { session.client.close(); });
      this.sessions.delete(id);
    }
  }
  dispose(): void {
    this.disposed = true;
    for (const session of this.sessions.values()) { session.client.close(); }
    this.sessions.clear();
  }
}
