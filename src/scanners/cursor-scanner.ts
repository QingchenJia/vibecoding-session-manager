import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { Session, AgentType } from '../types.js';

export class CursorScanner extends BaseScanner {
  readonly agent: AgentType = 'cursor';

  getDisplayName(): string {
    return 'Cursor';
  }

  protected get workspaceStorageDir(): string | null {
    if (this.platform.isWindows) {
      return this.platform.appData
        ? path.join(this.platform.appData, 'Cursor', 'User', 'workspaceStorage')
        : null;
    }
    if (this.platform.isMacOS) {
      return path.join(
        this.platform.darwinUserSupport,
        'Cursor',
        'User',
        'workspaceStorage',
      );
    }
    return path.join(
      this.platform.xdgConfigHome!,
      'Cursor',
      'User',
      'workspaceStorage',
    );
  }

  async discover(): Promise<Session[]> {
    const wsDir = this.workspaceStorageDir;
    if (!wsDir || !(await this.dirExists(wsDir))) return [];
    return this.scanWorkspaceStorage(wsDir, 'cursor');
  }

  protected async scanWorkspaceStorage(
    wsDir: string,
    agent: AgentType,
  ): Promise<Session[]> {
    const sessions: Session[] = [];
    let hashes: string[];
    try {
      hashes = await fs.readdir(wsDir);
    } catch {
      return [];
    }

    for (const hash of hashes) {
      const hashPath = path.join(wsDir, hash);
      if (!(await this.dirExists(hashPath))) continue;

      const workspaceJson = await this.readJsonFile<{ folder?: string }>(
        path.join(hashPath, 'workspace.json'),
      );
      const workspaceName = workspaceJson?.folder
        ? decodeURIComponent(
            workspaceJson.folder
              .replace(/^file:\/\/\//, '')
              .replace(/^file:\/\//, ''),
          )
        : `Untitled (${hash.slice(0, 8)})`;

      const chatSessionsDir = path.join(hashPath, 'chatSessions');
      const sessionFiles = await this.findFilesRecursive(
        chatSessionsDir,
        ['.jsonl', '.json'],
        3,
      );

      for (const filePath of sessionFiles) {
        const stats = await this.getFileStats(filePath);
        if (stats.size === 0) continue;

        const filename = path.basename(filePath, path.extname(filePath));
        sessions.push({
          id: `${hash}-${filename}`,
          name: workspaceName,
          agent,
          path: filePath,
          lastModified: stats.mtime,
          size: stats.size,
        });
      }
    }

    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
  }

  async delete(session: Session): Promise<boolean> {
    try {
      await fs.unlink(session.path);
      return true;
    } catch {
      return false;
    }
  }
}
