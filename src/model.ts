import { posix } from 'node:path';

export const SCHEME = 'remoterfs';
export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  protocol: 'ftp' | 'ftps' | 'ftps-implicit';
  rootPath: string;
  timeout: number;
  atomicSave: boolean;
  /** Original dictionary key for profiles read from remotefs.remote. */
  configKey?: string;
}

export function validText(value: string): boolean {
  return value.length > 0 && !/[\r\n\0]/.test(value);
}

export function validateProfile(profile: ServerProfile): void {
  if (!/^[a-z0-9-]+$/.test(profile.id) || !validText(profile.name) ||
      !validText(profile.host) || /[\s/@]/.test(profile.host) ||
      !validText(profile.username) || !Number.isInteger(profile.port) ||
      profile.port < 1 || profile.port > 65535 ||
      !['ftp', 'ftps', 'ftps-implicit'].includes(profile.protocol) ||
      !Number.isFinite(profile.timeout) || profile.timeout < 1000 ||
      typeof profile.atomicSave !== 'boolean') {
    throw new Error('Invalid connection settings.');
  }
  remotePath(profile.rootPath, '/');
}

// The configured root is a view boundary. Server-side permissions remain authoritative.
export function remotePath(root: string, path: string): string {
  for (const part of [root, path]) {
    if (!part.startsWith('/') || /[\r\n\0\\]/.test(part) || part.split('/').includes('..')) {
      throw new Error('Enter an absolute path without "..", backslashes, or control characters.');
    }
  }
  return posix.join(root, path);
}

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
