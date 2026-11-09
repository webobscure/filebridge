export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  /** Exact names anywhere, or paths relative to the search folder; no globs. */
  exclude: string[];
  maxFileBytes: number;
  maxResults: number;
}
export interface SearchEntry { name: string; directory: boolean; link: boolean; size: number }
export interface SearchMatch { path: string; line: number; column: number; length: number; preview: string }
export interface SearchSummary {
  scanned: number; matches: number; excluded: number; binary: number; large: number; links: number;
  errors: number; issues: string[]; cancelled: boolean; limited: boolean;
}
export interface SearchSource {
  list(path: string): Promise<SearchEntry[]>;
  read(path: string, limit: number): Promise<Uint8Array>;
}
export class SearchFileTooLarge extends Error {}

export function validateSearch(options: SearchOptions): void {
  if (typeof options.query !== 'string' || !options.query.length || options.query.length > 1024 || /[\r\n\0]/.test(options.query)) {
    throw new Error('Enter a single line of text (1–1024 characters).');
  }
  if (typeof options.caseSensitive !== 'boolean' || !Number.isInteger(options.maxResults) || options.maxResults < 1 || options.maxResults > 50000 ||
      !Number.isInteger(options.maxFileBytes) || options.maxFileBytes < 1 || options.maxFileBytes > 128 * 1024 * 1024) {
    throw new Error('Invalid search limits.');
  }
  if (!Array.isArray(options.exclude) || options.exclude.some(value => typeof value !== 'string' || !value.trim() || !value.replace(/\//g, '') || /[\r\n\0\\*?]/.test(value) || value.split('/').includes('..'))) {
    throw new Error('Search exclusions must be exact names or relative paths, without wildcards or "..".');
  }
}

export function excluded(relative: string, rules: string[]): boolean {
  return rules.some(rule => {
    const clean = rule.replace(/^\/+|\/+$/g, '');
    return clean.includes('/') ? relative === clean || relative.startsWith(clean + '/') : relative.split('/').includes(clean);
  });
}

/** Reads one file at a time. Nothing is uploaded or added to the editor's document cache. */
export async function searchRemote(source: SearchSource, root: string, options: SearchOptions,
  cancelled: () => boolean, onMatch: (match: SearchMatch) => void,
  progress: (summary: SearchSummary, path: string) => void = () => {}): Promise<SearchSummary> {
  validateSearch(options);
  const summary: SearchSummary = { scanned: 0, matches: 0, excluded: 0, binary: 0, large: 0, links: 0, errors: 0,
    issues: [], cancelled: false, limited: false };
  const folders = [root.replace(/\/$/, '') || '/'];
  const base = root.replace(/\/$/, '');
  const pattern = new RegExp(options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? 'gu' : 'giu');
  const issue = (path: string) => {
    summary.errors++;
    if (summary.issues.length < 100) summary.issues.push(`Could not read ${path}. Check permissions and connection.`);
  };
  while (folders.length && !cancelled() && !summary.limited) {
    const folder = folders.pop()!;
    let entries: SearchEntry[];
    try { entries = await source.list(folder); }
    catch { if (!cancelled()) issue(folder); continue; }
    for (const entry of entries) {
      if (cancelled() || summary.limited) break;
      // Never let a listing introduce traversal or FTP command injection.
      if (!entry.name || ['.', '..'].includes(entry.name) || /[/\\\r\n\0]/.test(entry.name)) continue;
      const path = (folder === '/' ? '' : folder) + '/' + entry.name;
      if (excluded(path.slice(base.length).replace(/^\//, ''), options.exclude)) { summary.excluded++; continue; }
      if (entry.link) { summary.links++; continue; }
      if (entry.directory) { folders.push(path); continue; }
      if (entry.size > options.maxFileBytes) { summary.large++; continue; }
      progress(summary, path);
      let bytes: Uint8Array;
      try { bytes = await source.read(path, options.maxFileBytes); }
      catch (error) { if (!cancelled()) { if (error instanceof SearchFileTooLarge) summary.large++; else issue(path); } continue; }
      if (cancelled()) break;
      if (bytes.length > options.maxFileBytes) { summary.large++; continue; }
      let text: string;
      try {
        if (bytes.includes(0)) throw new Error('Binary');
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch { summary.binary++; continue; }
      summary.scanned++;
      const lines = text.split(/\r\n|\n|\r/);
      for (let line = 0; line < lines.length && !summary.limited && !cancelled(); line++) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while (!cancelled() && (match = pattern.exec(lines[line])) !== null) {
          const start = Math.max(0, match.index - 60);
          onMatch({ path, line, column: match.index, length: match[0].length,
            preview: (start ? '…' : '') + lines[line].slice(start, Math.max(start + 180, match.index + Math.min(match[0].length, 120))) });
          if (++summary.matches >= options.maxResults) { summary.limited = true; break; }
        }
      }
    }
  }
  summary.cancelled = cancelled();
  return summary;
}
