const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeTime(timestampMs: number): string {
  const diff = Date.now() - timestampMs;
  if (diff < 0) return 'just now';
  if (diff < MINUTE) return '<1m ago';
  if (diff < HOUR) return `${Math.round(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`;
  if (diff < MONTH) return `${Math.round(diff / DAY)}d ago`;
  if (diff < YEAR) return `${Math.round(diff / MONTH)}mo ago`;
  return `${Math.round(diff / YEAR)}y ago`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

const PLATFORM_SEP = process.platform === 'win32' ? '\\' : '/';

export function decodeProjectName(encoded: string): string {
  // Claude Code encodes paths like "D--Code-vibecoding-session-manager"
  // Replace -- with platform separator, single - with space where appropriate
  return encoded.replace(/--/g, PLATFORM_SEP);
}
