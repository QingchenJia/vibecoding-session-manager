import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { Session, AgentType, SessionDetail } from '../types.js';

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

  async inspect(session: Session): Promise<SessionDetail> {
    const detail: SessionDetail = { session };
    detail.rawFiles = [this.indexPath];

    // Try to read thread metadata from SQLite
    const stateDbPath = path.join(this.codexDir, 'state_5.sqlite');
    if (await this.fileExists(stateDbPath)) {
      try {
        const db = new Database(stateDbPath);
        const row = db.prepare(
          'SELECT first_user_message, title, rollout_path, tokens_used FROM threads WHERE id = ?',
        ).get(session.id) as Record<string, unknown> | undefined;
        db.close();

        if (row) {
          detail.firstUserMessage = row.first_user_message as string;
          detail.messageCount = row.tokens_used ? undefined : undefined; // Codex doesn't track message count directly
          const rp = row.rollout_path as string;
          if (rp) {
            const fullRp = path.join(this.codexDir, rp);
            if (await this.fileExists(fullRp)) {
              detail.rawFiles!.push(fullRp);
              // Try reading rollout for more detail
              try {
                const rc = await fs.readFile(fullRp, 'utf-8');
                const lines = rc.split('\n').filter((l) => l.trim());
                let msgCount = 0;
                const preview: string[] = [];
                for (const l of lines) {
                  try {
                    const e = JSON.parse(l);
                    if (e.type === 'response_item' && e.payload?.content) {
                      for (const c of e.payload.content) {
                        if (c.text) {
                          msgCount++;
                          if (preview.length < 10) preview.push(`[${e.payload.role || '?'}] ${c.text.slice(0, 120)}`);
                        }
                      }
                    }
                  } catch { continue; }
                }
                detail.messageCount = msgCount;
                detail.preview = preview;
              } catch { /* skip */ }
            }
          }
        }
      } catch { /* skip */ }
    }

    return detail;
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

      // Clean up SQLite databases so the VS Code plugin no longer sees the session
      await this.cleanSessionData(session.id);

      return true;
    } catch {
      return false;
    }
  }

  private async cleanSessionData(threadId: string): Promise<void> {
    const stateDbPath = path.join(this.codexDir, 'state_5.sqlite');
    const logsDbPath = path.join(this.codexDir, 'logs_2.sqlite');

    // Clean state_5.sqlite — the authoritative thread store
    if (await this.fileExists(stateDbPath)) {
      try {
        const db = new Database(stateDbPath);
        // CASCADE handles thread_goals, thread_dynamic_tools, stage1_outputs
        db.prepare('DELETE FROM threads WHERE id = ?').run(threadId);
        // No FK constraint, must manually clean
        db.prepare(
          'DELETE FROM thread_spawn_edges WHERE parent_thread_id = ? OR child_thread_id = ?',
        ).run(threadId, threadId);
        // Disassociate job items from deleted thread (keep the items)
        db.prepare(
          'UPDATE agent_job_items SET assigned_thread_id = NULL WHERE assigned_thread_id = ?',
        ).run(threadId);
        db.close();
      } catch {
        // Best-effort
      }
    }

    // Clean logs_2.sqlite — conversation log entries
    if (await this.fileExists(logsDbPath)) {
      try {
        const db = new Database(logsDbPath);
        db.prepare('DELETE FROM logs WHERE thread_id = ?').run(threadId);
        db.close();
      } catch {
        // Best-effort
      }
    }

    // Clean sessions directory — rollout files with thread ID in filename
    const sessionsDir = path.join(this.codexDir, 'sessions');
    if (await this.dirExists(sessionsDir)) {
      try {
        const files = await this.findFilesRecursive(sessionsDir, ['.jsonl']);
        for (const file of files) {
          if (path.basename(file).includes(threadId)) {
            await fs.unlink(file);
          }
        }
      } catch {
        // Best-effort
      }
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
