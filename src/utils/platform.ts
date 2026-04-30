import os from 'node:os';
import path from 'node:path';
import type { PlatformInfo } from '../types.js';

export function detectPlatform(): PlatformInfo {
  const homeDir = os.homedir();
  const platform = os.platform();
  const isWindows = platform === 'win32';
  const isMacOS = platform === 'darwin';
  const isLinux = platform === 'linux';

  return {
    isWindows,
    isMacOS,
    isLinux,
    homeDir,
    appData: process.env.APPDATA || null,
    localAppData: process.env.LOCALAPPDATA || null,
    darwinUserSupport: path.join(homeDir, 'Library', 'Application Support'),
    xdgDataHome:
      process.env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'),
    xdgConfigHome:
      process.env.XDG_CONFIG_HOME || path.join(homeDir, '.config'),
  };
}
