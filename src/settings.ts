import { createHash } from 'node:crypto';
import { ServerProfile, validateProfile, validText } from './model';

export interface ConfiguredProfiles {
  profiles: ServerProfile[];
  passwords: Map<string, string>;
  errors: string[];
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Routing changes get a new URI identity: an old open document must never save to a new host/root.
export function configuredId(key: string, profile: Pick<ServerProfile, 'protocol' | 'host' | 'port' | 'username' | 'rootPath'>): string {
  return `settings-${createHash('sha256').update(JSON.stringify([
    key, profile.protocol, profile.host, profile.port, profile.username, profile.rootPath
  ])).digest('hex').slice(0, 32)}`;
}

export function parseRemotes(value: unknown): ConfiguredProfiles {
  const result: ConfiguredProfiles = { profiles: [], passwords: new Map(), errors: [] };
  if (!object(value)) {
    result.errors.push('remotefs.remote must be an object containing named connections.');
    return result;
  }
  for (const [key, entry] of Object.entries(value)) {
    try {
      if (!validText(key) || !object(entry)) { throw new Error(); }
      const protocol = entry.scheme ?? 'ftp';
      const profile: ServerProfile = {
        id: 'pending', configKey: key,
        name: (entry.name ?? key) as string,
        protocol: protocol as ServerProfile['protocol'], host: entry.host as string,
        port: (entry.port ?? (protocol === 'ftps-implicit' ? 990 : 21)) as number,
        username: entry.username as string, rootPath: (entry.rootPath ?? '/') as string,
        timeout: (entry.connectTimeout ?? 30000) as number, atomicSave: (entry.atomicSave ?? true) as boolean
      };
      // Runtime validation is required even when settings.json has a schema.
      if (typeof profile.name !== 'string' || typeof profile.host !== 'string' ||
          typeof profile.username !== 'string' || typeof profile.rootPath !== 'string') { throw new Error(); }
      validateProfile(profile);
      if (entry.password !== undefined && (typeof entry.password !== 'string' || /[\r\n\0]/.test(entry.password))) {
        throw new Error();
      }
      profile.id = configuredId(key, profile);
      result.profiles.push(profile);
      if (typeof entry.password === 'string') { result.passwords.set(profile.id, entry.password); }
    } catch {
      // Never echo configuration values: they may contain passwords.
      result.errors.push(`remotefs.remote[${JSON.stringify(key)}]: check host, username, scheme, port, rootPath, and the other fields.`);
    }
  }
  return result;
}
