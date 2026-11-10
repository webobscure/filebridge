import * as vscode from 'vscode';
import { SerialQueue, ServerProfile, validateProfile } from './model';
import { parseRemotes } from './settings';

export class Profiles {
  private saved: ServerProfile[];
  private readonly writes = new SerialQueue();
  constructor(private readonly context: vscode.ExtensionContext) {
    this.saved = context.globalState.get<ServerProfile[]>('servers', []);
    this.saved.forEach(validateProfile);
  }
  private local(): ServerProfile[] {
    // Older editors can deliver an earlier Memento storage notification after
    // update() resolves. Keep this window's successful writes authoritative.
    return [...this.saved];
  }
  private update(change: (current: ServerProfile[]) => ServerProfile[]): Promise<void> {
    return this.writes.run(async () => {
      const next = change(this.local());
      next.forEach(validateProfile);
      await this.context.globalState.update('servers', next);
      this.saved = next;
    });
  }
  mergeImported(profiles: ServerProfile[]): Promise<void> {
    return this.update(current => {
      const ids = new Set(current.map(profile => profile.id));
      return [...current, ...profiles.filter(profile => !ids.has(profile.id))];
    });
  }
  private configured() {
    return parseRemotes(vscode.workspace.getConfiguration('remotefs').get<unknown>('remote', {}));
  }
  list(): ServerProfile[] { return [...this.local(), ...this.configured().profiles]; }
  configurationErrors(): string[] { return this.configured().errors; }
  hasConfiguredPassword(id: string): boolean { return this.configured().passwords.has(id); }
  get(id: string): ServerProfile {
    const profile = this.list().find(p => p.id === id);
    if (!profile) { throw vscode.FileSystemError.Unavailable(`Connection not found (${id}). Add a server in FileBridge.`); }
    return profile;
  }
  async add(profile: ServerProfile, password: string): Promise<void> {
    validateProfile(profile);
    await this.context.secrets.store(`password:${profile.id}`, password);
    try {
      await this.update(current => [...current, profile]);
    } catch (error) {
      await this.context.secrets.delete(`password:${profile.id}`);
      throw error;
    }
  }
  async remove(id: string): Promise<void> {
    if (this.get(id).configKey !== undefined) { throw new Error('Remove the connection from remotefs.remote in Settings.'); }
    await this.update(current => current.filter(p => p.id !== id));
    await this.context.secrets.delete(`password:${id}`);
  }
  async password(id: string): Promise<string> {
    this.get(id);
    const configured = this.configured().passwords;
    if (configured.has(id)) { return configured.get(id)!; }
    const password = await this.context.secrets.get(`password:${id}`);
    if (password !== undefined) { return password; }
    throw vscode.FileSystemError.Unavailable('No password is saved. Run "FileBridge: Change Password".');
  }
  setPassword(id: string, password: string): Thenable<void> {
    if (this.hasConfiguredPassword(id)) { throw new Error('Edit password in remotefs.remote, or remove the field to use secure storage.'); }
    return this.context.secrets.store(`password:${id}`, password);
  }
}
