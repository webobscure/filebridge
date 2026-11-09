import * as vscode from 'vscode';
import { ServerProfile, validateProfile } from './model';

export const LEGACY_EXTENSION_ID = 'remoter-fs-local.remoter-fs';
export const FILEBRIDGE_EXTENSION_ID = 'webobscure.filebridge';

export function migrationCommandId(sourceId: string): string {
  return `filebridge.migrateLegacyConnections.${sourceId.toLowerCase().replace(/\./g, '-')}`;
}

export interface LegacyState {
  servers: ServerProfile[];
  passwords: { id: string; password: string }[];
}
export interface MigrationTarget {
  importLegacyState(state: LegacyState): Promise<void>;
}

// Secrets move directly between extension contexts, never through files, settings, or logs.
export async function importLegacyState(context: vscode.ExtensionContext, value: unknown): Promise<void> {
  const state = value as LegacyState | undefined;
  if (!state || !Array.isArray(state.servers) || !Array.isArray(state.passwords)) {
    throw new Error('Invalid legacy connection data.');
  }
  const ids = new Set<string>();
  for (const profile of state.servers) {
    validateProfile(profile);
    if (profile.configKey !== undefined || ids.has(profile.id)) { throw new Error('Invalid legacy connection data.'); }
    ids.add(profile.id);
  }
  for (const secret of state.passwords) {
    if (!secret || typeof secret.id !== 'string' || !/^[a-z0-9-]+$/.test(secret.id) ||
        typeof secret.password !== 'string' || /[\r\n\0]/.test(secret.password)) {
      throw new Error('Invalid legacy password data.');
    }
  }
  context.globalState.get<ServerProfile[]>('servers', []).forEach(validateProfile);
  for (const secret of state.passwords) {
    const key = `password:${secret.id}`;
    if (await context.secrets.get(key) === undefined) { await context.secrets.store(key, secret.password); }
  }
  // Secure storage may await OS interaction. Read profiles after those awaits so
  // connections saved while passwords were being transferred are retained.
  const existing = context.globalState.get<ServerProfile[]>('servers', []);
  existing.forEach(validateProfile);
  const existingIds = new Set(existing.map(profile => profile.id));
  await context.globalState.update('servers', [...existing, ...state.servers.filter(profile => !existingIds.has(profile.id))]);
  // The helper owns the completion marker in its own context. Keep the target
  // import to one state write: Memento saves whole snapshots, including servers.
}
