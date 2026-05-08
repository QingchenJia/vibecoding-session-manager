import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { Session, AgentType, SessionDetail, TokenUsage } from '../types.js';

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
    const sessions: Session[] = [];
    const seen = new Set<string>();

    // Source 1: session_index.jsonl (VS Code plugin sessions)
    const indexPath = this.indexPath;
    if (await this.fileExists(indexPath)) {
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          const entry = this.parseEntry(line);
          if (!entry) continue;

          const lastModified = new Date(entry.updated_at).getTime();
          if (isNaN(lastModified)) continue;

          seen.add(entry.id);
          sessions.push({
            id: entry.id,
            name: entry.thread_name || `Session ${entry.id.slice(0, 8)}`,
            agent: 'codex',
            path: indexPath,
            lastModified,
            size: 0,
          });
        }
      } catch { /* index read failed, continue with filesystem scan */ }
    }

    // Source 2: ~/.codex/sessions/ (CLI rollout files)
    const fsSessions = await this.discoverFromSessionsDir(seen);
    sessions.push(...fsSessions);

    // Estimate per-session size from SQLite for index-based sessions
    const dbSize = await this.getTotalDbSize();
    if (dbSize > 0 && sessions.length > 0) {
      const perSession = Math.round(dbSize / sessions.length);
      for (const s of sessions) {
        if (s.size === 0) s.size = perSession;
      }
    }

    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
  }

  private async discoverFromSessionsDir(seen: Set<string>): Promise<Session[]> {
    const sessionsDir = path.join(this.codexDir, 'sessions');
    if (!(await this.dirExists(sessionsDir))) return [];

    const files = await this.findFilesRecursive(sessionsDir, ['.jsonl']);
    const sessions: Session[] = [];

    for (const filePath of files) {
      const id = this.extractSessionId(path.basename(filePath));
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const stats = await this.getFileStats(filePath);
      const meta = await this.readSessionMeta(filePath);

      sessions.push({
        id,
        name: meta.name || `Session ${id.slice(0, 8)}`,
        agent: 'codex',
        path: filePath,
        lastModified: stats.mtime || Date.now(),
        size: stats.size,
      });
    }

    return sessions;
  }

  private extractSessionId(filename: string): string | null {
    const match = filename.match(
      /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/,
    );
    return match ? match[1] : null;
  }

  private async readSessionMeta(
    filePath: string,
  ): Promise<{ name: string }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const firstLine = content.split('\n').find((l) => l.trim());
      if (!firstLine) return { name: '' };

      const entry = JSON.parse(firstLine);
      if (entry.type === 'session_meta' && entry.payload?.cwd) {
        return { name: path.basename(entry.payload.cwd) };
      }
      return { name: '' };
    } catch {
      return { name: '' };
    }
  }

  async inspect(session: Session): Promise<SessionDetail> {
    const detail: SessionDetail = { session };

    // Determine if this is a filesystem-discovered session (path points to rollout)
    const isRolloutPath = session.path.endsWith('.jsonl') &&
      path.dirname(session.path) !== this.codexDir;
    detail.rawFiles = isRolloutPath ? [session.path] : [this.indexPath];

    // Try SQLite for additional metadata
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
          detail.tokenUsage = this.parseTokenUsage(row.tokens_used);
          const rp = row.rollout_path as string;
          if (rp) {
            const fullRp = path.join(this.codexDir, rp);
            if (!isRolloutPath && await this.fileExists(fullRp)) {
              detail.rawFiles!.push(fullRp);
            }
            await this.populateRolloutDetail(fullRp, detail);
          }
        }
      } catch { /* skip */ }
    }

    // For filesystem-discovered sessions without SQLite data, read rollout directly
    if (!detail.firstUserMessage && isRolloutPath) {
      await this.populateRolloutDetail(session.path, detail);
    }

    return detail;
  }

  private async populateRolloutDetail(
    rolloutPath: string,
    detail: SessionDetail,
  ): Promise<void> {
    try {
      const rc = await fs.readFile(rolloutPath, 'utf-8');
      const lines = rc.split('\n').filter((l) => l.trim());
      let msgCount = 0;
      const preview: string[] = [];

      for (const l of lines) {
        try {
          const e = JSON.parse(l);
          if (e.type === 'session_meta' && !detail.firstUserMessage) {
            detail.firstUserMessage = e.payload?.cwd || undefined;
          }
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

  async delete(session: Session): Promise<boolean> {
    // Remove from session_index.jsonl if it exists
    const indexPath = this.indexPath;
    if (await this.fileExists(indexPath)) {
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());
        const filtered = lines.filter((line) => {
          const entry = this.parseEntry(line);
          return !entry || entry.id !== session.id;
        });
        await fs.writeFile(
          indexPath,
          filtered.join('\n') + (filtered.length > 0 ? '\n' : ''),
          'utf-8',
        );
      } catch { /* best-effort on index, still try to clean data */ }
    }

    // Clean up session data (SQLite + sessions directory files)
    await this.cleanSessionData(session.id);
    return true;
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

  private parseTokenUsage(raw: unknown): TokenUsage | undefined {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'number' && raw > 0) {
      return { input: raw, output: 0, total: raw };
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'number' && parsed > 0) {
          return { input: parsed, output: 0, total: parsed };
        }
        if (typeof parsed === 'object' && parsed !== null) {
          const input = (parsed.input_tokens || parsed.input || 0) as number;
          const output = (parsed.output_tokens || parsed.output || 0) as number;
          const cacheRead = (parsed.cache_read_input_tokens || parsed.cacheRead || undefined) as number | undefined;
          if (input > 0 || output > 0) {
            return { input, output, total: input + output + (cacheRead || 0), cacheRead };
          }
        }
      } catch { /* not JSON */ }
      const num = Number(raw);
      if (!isNaN(num) && num > 0) {
        return { input: num, output: 0, total: num };
      }
    }
    return undefined;
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
