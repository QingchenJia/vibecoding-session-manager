import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { Session, AgentType } from '../types.js';
import { decodeProjectName } from '../utils/formatters.js';

export class ClaudeCodeScanner extends BaseScanner {
  readonly agent: AgentType = 'cc';

  getDisplayName(): string {
    return 'Claude Code';
  }

  private get projectsDir(): string {
    return path.join(this.platform.homeDir, '.claude', 'projects');
  }

  async discover(): Promise<Session[]> {
    const projectsDir = this.projectsDir;
    if (!(await this.dirExists(projectsDir))) return [];

    const sessions: Session[] = [];
    let projectDirs: string[];
    try {
      projectDirs = await fs.readdir(projectsDir);
    } catch {
      return [];
    }

    for (const projectName of projectDirs) {
      if (projectName === 'memory') continue;
      const projectPath = path.join(projectsDir, projectName);
      if (!(await this.dirExists(projectPath))) continue;

      const entries = await fs.readdir(projectPath).catch(() => [] as string[]);
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue;
        const sessionPath = path.join(projectPath, entry);
        const stats = await this.getFileStats(sessionPath);
        if (stats.size === 0) continue;

        const sessionId = entry.replace(/\.jsonl$/, '');

        sessions.push({
          id: sessionId,
          name: decodeProjectName(projectName),
          agent: 'cc',
          path: sessionPath,
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

      // Also remove the session's subfolder if it exists
      const sessionDir = path.join(path.dirname(session.path), session.id);
      if (await this.dirExists(sessionDir)) {
        await fs.rm(sessionDir, { recursive: true, force: true });
      }

      // If the project dir is now empty, remove it
      const projectDir = path.dirname(session.path);
      const remaining = await fs.readdir(projectDir).catch(() => [] as string[]);
      const nonJsonl = remaining.filter((f) => !f.endsWith('.jsonl'));
      if (nonJsonl.length === 0 && remaining.length === 0) {
        await fs.rm(projectDir, { recursive: true, force: true });
      }

      return true;
    } catch {
      return false;
    }
  }
}
