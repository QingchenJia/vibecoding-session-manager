import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { Session, AgentType } from '../types.js';

interface CodexSessionEntry {
  id: string;
  thread_name: string;
  updated_at: string;
}

export class CodexScanner extends BaseScanner {
  readonly agent: AgentType = 'codex';

  getDisplayName(): string {
    return 'Codex (OpenAI)';
  }

  private get codexDir(): string {
    return path.join(this.platform.homeDir, '.codex');
  }

  private get indexPath(): string {
    return path.join(this.codexDir, 'session_index.jsonl');
  }

  async discover(): Promise<Session[]> {
    const indexPath = this.indexPath;
    if (!(await this.fileExists(indexPath))) return [];

    let content: string;
    try {
      content = await fs.readFile(indexPath, 'utf-8');
    } catch {
      return [];
    }

    const sessions: Session[] = [];
    const lines = content.split('\n').filter((line) => line.trim());

    for (const line of lines) {
      const entry = this.parseEntry(line);
      if (!entry) continue;

      const lastModified = new Date(entry.updated_at).getTime();
      if (isNaN(lastModified)) continue;

      sessions.push({
        id: entry.id,
        name: entry.thread_name || `Session ${entry.id.slice(0, 8)}`,
        agent: 'codex',
        path: indexPath, // index file as reference
        lastModified,
        size: 0, // conversation data is in shared SQLite
      });
    }

    // Estimate per-session size from SQLite databases
    const dbSize = await this.getTotalDbSize();
    if (dbSize > 0 && sessions.length > 0) {
      const perSession = Math.round(dbSize / sessions.length);
      for (const s of sessions) {
        s.size = perSession;
      }
    }

    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
  }

  async delete(session: Session): Promise<boolean> {
    const indexPath = this.indexPath;
    try {
      const content = await fs.readFile(indexPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      const filtered = lines.filter((line) => {
        const entry = this.parseEntry(line);
        return !entry || entry.id !== session.id;
      });

      await fs.writeFile(indexPath, filtered.join('\n') + (filtered.length > 0 ? '\n' : ''), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  private parseEntry(line: string): CodexSessionEntry | null {
    try {
      return JSON.parse(line) as CodexSessionEntry;
    } catch {
      return null;
    }
  }

  private async getTotalDbSize(): Promise<number> {
    const dbFiles = ['logs_2.sqlite', 'state_5.sqlite'];
    let total = 0;

    for (const dbFile of dbFiles) {
      try {
        const dbPath = path.join(this.codexDir, dbFile);
        const stat = await fs.stat(dbPath);
        total += stat.size;
      } catch { /* skip */ }
    }

    return total;
  }
}
