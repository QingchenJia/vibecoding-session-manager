import Database from 'better-sqlite3';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { AgentType, Session, SessionDetail, TokenUsage } from '../types.js';

type JsonObject = Record<string, unknown>;

interface ParsedMessage {
  role: 'user' | 'assistant';
  text: string;
}

export class OpenCodeScanner extends BaseScanner {
  readonly agent: AgentType = 'opencode';

  getDisplayName(): string {
    return 'OpenCode';
  }

  private get dataDir(): string {
    return process.env.OPENCODE_DATA_DIR || path.join(this.platform.homeDir, '.local', 'share', 'opencode');
  }

  async discover(): Promise<Session[]> {
    const sessions: Session[] = [];
    const seen = new Set<string>();

    for (const dbPath of await this.getDbPaths()) {
      const dbSessions = await this.discoverFromDb(dbPath);
      for (const session of dbSessions) {
        seen.add(session.id);
        sessions.push(session);
      }
    }

    for (const session of await this.discoverFromJsonStorage(seen)) {
      sessions.push(session);
    }

    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
  }

  async inspect(session: Session): Promise<SessionDetail> {
    if (session.path.endsWith('.db')) return this.inspectDbSession(session);
    return this.inspectJsonSession(session);
  }

  async delete(session: Session): Promise<boolean> {
    try {
      if (session.path.endsWith('.db')) {
        const db = new Database(session.path);
        try {
          const tx = db.transaction(() => {
            this.deleteFromTable(db, 'part', 'session_id', session.id);
            this.deleteFromTable(db, 'message', 'session_id', session.id);
            this.deleteFromTable(db, 'session_message', 'session_id', session.id);
            this.deleteFromTable(db, 'todo', 'session_id', session.id);
            this.deleteFromTable(db, 'session', 'id', session.id);
          });
          tx();
        } finally {
          db.close();
        }
      } else {
        await fs.unlink(session.path);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async getDbPaths(): Promise<string[]> {
    const candidates = new Set<string>();
    const envDb = process.env.OPENCODE_DB;
    if (envDb && envDb !== ':memory:') {
      candidates.add(path.isAbsolute(envDb) ? envDb : path.join(this.dataDir, envDb));
    }

    if (await this.dirExists(this.dataDir)) {
      candidates.add(path.join(this.dataDir, 'opencode.db'));
      const files = await fs.readdir(this.dataDir).catch(() => [] as string[]);
      for (const file of files) {
        if (/^opencode-[\w.-]+\.db$/.test(file)) candidates.add(path.join(this.dataDir, file));
      }
    }

    const existing: string[] = [];
    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) existing.push(candidate);
    }
    return existing;
  }

  private async discoverFromDb(dbPath: string): Promise<Session[]> {
    const sessions: Session[] = [];
    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      if (!this.tableExists(db, 'session')) return [];

      const rows = db.prepare('SELECT * FROM session').all() as JsonObject[];
      const dbSize = (await this.getFileStats(dbPath)).size;
      const perSessionSize = rows.length > 0 ? Math.round(dbSize / rows.length) : 0;

      for (const row of rows) {
        const id = this.stringValue(row.id);
        if (!id) continue;
        sessions.push({
          id,
          name: this.sessionName(row, id),
          agent: 'opencode',
          path: dbPath,
          lastModified: this.timeValue(row.time_updated ?? row.time_created),
          size: perSessionSize,
        });
      }
    } catch {
      return [];
    } finally {
      db?.close();
    }
    return sessions;
  }

  private async discoverFromJsonStorage(seen: Set<string>): Promise<Session[]> {
    const projectDir = path.join(this.dataDir, 'project');
    if (!(await this.dirExists(projectDir))) return [];

    const files = await this.findFilesRecursive(projectDir, ['.json'], 8);
    const sessions: Session[] = [];
    for (const filePath of files) {
      const normalized = filePath.replace(/\\/g, '/');
      if (!normalized.includes('/storage/session/')) continue;

      const data = await this.readJsonFile<JsonObject>(filePath);
      if (!data) continue;
      const id = this.stringValue(data.id) || path.basename(filePath, path.extname(filePath));
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const stats = await this.getFileStats(filePath);
      if (stats.size === 0) continue;
      sessions.push({
        id,
        name: this.sessionName(data, id),
        agent: 'opencode',
        path: filePath,
        lastModified: this.timeValue(data.time_updated ?? data.updatedAt ?? data.updated_at) || stats.mtime,
        size: stats.size,
      });
    }

    return sessions;
  }

  private async inspectDbSession(session: Session): Promise<SessionDetail> {
    const detail: SessionDetail = { session, rawFiles: [session.path] };
    let db: Database.Database | null = null;

    try {
      db = new Database(session.path, { readonly: true, fileMustExist: true });
      const sessionRow = this.getSessionRow(db, session.id);
      const messages = this.getDbMessages(db, session.id);
      const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.text);

      detail.messageCount = messages.length;
      detail.firstUserMessage = userMessages[0];
      detail.lastUserMessage = userMessages[userMessages.length - 1];
      detail.preview = messages.slice(0, 10).map((m) => `[${m.role}] ${m.text.slice(0, 120)}`);
      detail.tokenUsage = sessionRow ? this.tokenUsageFromRow(sessionRow) : undefined;
    } catch { /* best effort */ } finally {
      db?.close();
    }

    return detail;
  }

  private async inspectJsonSession(session: Session): Promise<SessionDetail> {
    const detail: SessionDetail = { session, rawFiles: [session.path] };
    try {
      const data = await this.readJsonFile<JsonObject | unknown[]>(session.path);
      const messages = this.extractMessages(data);
      const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.text);

      detail.messageCount = messages.length;
      detail.firstUserMessage = userMessages[0];
      detail.lastUserMessage = userMessages[userMessages.length - 1];
      detail.preview = messages.slice(0, 10).map((m) => `[${m.role}] ${m.text.slice(0, 120)}`);
      detail.tokenUsage = this.tokenUsageFromRow((data || {}) as JsonObject);
    } catch { /* best effort */ }
    return detail;
  }

  private getDbMessages(db: Database.Database, sessionId: string): ParsedMessage[] {
    const messages: ParsedMessage[] = [];
    const messageRoles = new Map<string, ParsedMessage['role']>();

    if (this.tableExists(db, 'message')) {
      const rows = db.prepare('SELECT * FROM message WHERE session_id = ? ORDER BY time_created, id').all(sessionId) as JsonObject[];
      for (const row of rows) {
        const data = this.parseJson(row.data);
        const role = this.normalizeRole((data as JsonObject)?.role ?? (data as JsonObject)?.type ?? row.role);
        const id = this.stringValue(row.id);
        if (id && role) messageRoles.set(id, role);
        const text = this.getText(data);
        if (role && text) messages.push({ role, text });
      }
    }

    if (messages.length === 0 && this.tableExists(db, 'part')) {
      const rows = db.prepare('SELECT * FROM part WHERE session_id = ? ORDER BY time_created, id').all(sessionId) as JsonObject[];
      for (const row of rows) {
        const data = this.parseJson(row.data);
        const role = this.normalizeRole((data as JsonObject)?.role ?? messageRoles.get(this.stringValue(row.message_id)));
        const text = this.getText(data);
        if (role && text) messages.push({ role, text });
      }
    }

    if (this.tableExists(db, 'session_message')) {
      const rows = db.prepare('SELECT * FROM session_message WHERE session_id = ? ORDER BY time_created, id').all(sessionId) as JsonObject[];
      for (const row of rows) {
        const data = this.parseJson(row.data);
        const role = this.normalizeRole(row.type ?? (data as JsonObject)?.role);
        const text = this.getText(data);
        if (role && text) messages.push({ role, text });
      }
    }

    return messages;
  }

  private extractMessages(data: unknown): ParsedMessage[] {
    if (!data) return [];
    const root = this.unwrapJson(data);
    const arrays = Array.isArray(root) ? [root] : this.findArrays(root);
    const messages: ParsedMessage[] = [];

    for (const arr of arrays) {
      for (const item of arr) {
        const obj = item as JsonObject;
        const role = this.normalizeRole(obj?.role ?? obj?.type);
        const text = this.getText(item);
        if (role && text) messages.push({ role, text });
      }
      if (messages.length > 0) break;
    }

    return messages;
  }

  private findArrays(data: unknown): unknown[][] {
    if (!data || typeof data !== 'object') return [];
    const obj = data as JsonObject;
    const arrays: unknown[][] = [];
    for (const key of ['messages', 'parts', 'history', 'conversation']) {
      if (Array.isArray(obj[key])) arrays.push(obj[key] as unknown[]);
    }
    return arrays;
  }

  private getSessionRow(db: Database.Database, sessionId: string): JsonObject | null {
    if (!this.tableExists(db, 'session')) return null;
    return db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId) as JsonObject | undefined || null;
  }

  private tokenUsageFromRow(row: JsonObject): TokenUsage | undefined {
    const input = this.numberValue(row.tokens_input ?? row.input_tokens ?? row.prompt_tokens);
    const output = this.numberValue(row.tokens_output ?? row.output_tokens ?? row.completion_tokens);
    const cacheRead = this.numberValue(row.tokens_cache_read ?? row.cache_read_input_tokens);
    const cacheCreate = this.numberValue(row.tokens_cache_write ?? row.cache_creation_input_tokens);
    const total = this.numberValue(row.tokens_total ?? row.total_tokens);

    if (input === 0 && output === 0 && cacheRead === 0 && cacheCreate === 0 && total === 0) return undefined;
    return {
      input,
      output,
      total: total || input + output + cacheRead + cacheCreate,
      cacheRead: cacheRead > 0 ? cacheRead : undefined,
      cacheCreate: cacheCreate > 0 ? cacheCreate : undefined,
    };
  }

  private sessionName(row: JsonObject, id: string): string {
    return this.stringValue(row.title)
      || this.stringValue(row.slug)
      || this.stringValue(row.directory)
      || this.stringValue(row.path)
      || `Session ${id.slice(0, 8)}`;
  }

  private deleteFromTable(db: Database.Database, table: string, column: string, value: string): void {
    if (!this.tableExists(db, table) || !this.columnExists(db, table, column)) return;
    db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(value);
  }

  private tableExists(db: Database.Database, table: string): boolean {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    return Boolean(row);
  }

  private columnExists(db: Database.Database, table: string, column: string): boolean {
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      return rows.some((row) => row.name === column);
    } catch {
      return false;
    }
  }

  private parseJson(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
  }

  private unwrapJson(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const obj = value as JsonObject;
    return obj.data ?? obj.session ?? value;
  }

  private normalizeRole(value: unknown): ParsedMessage['role'] | null {
    if (value === 'user') return 'user';
    if (value === 'assistant' || value === 'model') return 'assistant';
    return null;
  }

  private getText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    if (Array.isArray(value)) {
      return value.map((item) => this.getText(item)).filter(Boolean).join(' ');
    }

    const obj = value as JsonObject;
    for (const key of ['text', 'content', 'message', 'prompt', 'response', 'parts']) {
      const text = this.getText(obj[key]);
      if (text) return text;
    }
    return '';
  }

  private timeValue(value: unknown): number {
    if (typeof value === 'number') return value > 1_000_000_000_000 ? value : value * 1000;
    if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) return this.timeValue(numeric);
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  }

  private numberValue(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }
}
