import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { AgentType, Session, SessionDetail, TokenUsage } from '../types.js';

type JsonObject = Record<string, unknown>;

interface ParsedMessage {
  role: 'user' | 'assistant';
  text: string;
}

export class GeminiScanner extends BaseScanner {
  readonly agent: AgentType = 'gemini';

  getDisplayName(): string {
    return 'Gemini CLI';
  }

  private get geminiDir(): string {
    return path.join(this.platform.homeDir, '.gemini');
  }

  private get tmpDir(): string {
    return path.join(this.geminiDir, 'tmp');
  }

  async discover(): Promise<Session[]> {
    if (!(await this.dirExists(this.tmpDir))) return [];

    const files = await this.findFilesRecursive(this.tmpDir, ['.json'], 5);
    const sessions: Session[] = [];

    for (const filePath of files) {
      if (!this.isSessionFile(filePath)) continue;
      const stats = await this.getFileStats(filePath);
      if (stats.size === 0) continue;

      sessions.push({
        id: this.getSessionId(filePath),
        name: await this.getSessionName(filePath),
        agent: 'gemini',
        path: filePath,
        lastModified: stats.mtime,
        size: stats.size,
      });
    }

    sessions.sort((a, b) => b.lastModified - a.lastModified);
    return sessions;
  }

  async inspect(session: Session): Promise<SessionDetail> {
    const detail: SessionDetail = { session, rawFiles: [session.path] };

    try {
      const data = await this.readJsonFile<JsonObject | unknown[]>(session.path);
      if (!data) return detail;

      const messages = this.extractMessages(data);
      const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.text);
      const preview = messages.slice(0, 10).map((m) => `[${m.role}] ${m.text.slice(0, 120)}`);

      detail.messageCount = messages.length;
      detail.firstUserMessage = userMessages[0];
      detail.lastUserMessage = userMessages[userMessages.length - 1];
      detail.preview = preview;
      detail.tokenUsage = this.extractUsage(data);
    } catch { /* best effort */ }

    return detail;
  }

  async delete(session: Session): Promise<boolean> {
    try {
      await fs.unlink(session.path);
      return true;
    } catch {
      return false;
    }
  }

  private isSessionFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const normalized = filePath.replace(/\\/g, '/');
    if (fileName === 'logs.json') return false;
    if (fileName === 'settings.json') return false;
    if (normalized.includes('/checkpoint')) return true;
    if (normalized.includes('/chats/')) return fileName.endsWith('.json');
    return path.dirname(filePath) !== this.tmpDir && fileName.endsWith('.json');
  }

  private getSessionId(filePath: string): string {
    const project = this.getProjectHash(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    return project ? `${project}-${base}` : base;
  }

  private getProjectHash(filePath: string): string {
    const rel = path.relative(this.tmpDir, filePath);
    const first = rel.split(path.sep)[0];
    return first && first !== '..' ? first : '';
  }

  private async getSessionName(filePath: string): Promise<string> {
    try {
      const data = await this.readJsonFile<JsonObject | unknown[]>(filePath);
      if (data) {
        const firstUser = this.extractMessages(data).find((m) => m.role === 'user')?.text;
        if (firstUser) return firstUser.slice(0, 80);
        const name = this.stringFrom(data, ['title', 'name', 'tag', 'description']);
        if (name) return name;
      }
    } catch { /* skip */ }
    return path.basename(filePath, path.extname(filePath));
  }

  private extractMessages(data: unknown): ParsedMessage[] {
    const root = this.unwrapJson(data);
    const arrays = this.findMessageArrays(root);
    const messages: ParsedMessage[] = [];

    for (const arr of arrays) {
      for (const item of arr) {
        const role = this.normalizeRole((item as JsonObject | undefined)?.role);
        const text = this.getText(item);
        if (role && text) messages.push({ role, text });
      }
      if (messages.length > 0) break;
    }

    return messages;
  }

  private findMessageArrays(data: unknown): unknown[][] {
    if (Array.isArray(data)) return [data];
    if (!data || typeof data !== 'object') return [];

    const obj = data as JsonObject;
    const arrays: unknown[][] = [];
    for (const key of ['history', 'messages', 'conversation', 'turns', 'records']) {
      if (Array.isArray(obj[key])) arrays.push(obj[key] as unknown[]);
    }
    return arrays;
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

  private extractUsage(data: unknown): TokenUsage | undefined {
    const usage = this.findUsage(this.unwrapJson(data));
    if (!usage) return undefined;

    const input = this.numberFrom(usage, ['promptTokens', 'prompt_tokens', 'inputTokens', 'input_tokens']);
    const output = this.numberFrom(usage, ['completionTokens', 'completion_tokens', 'outputTokens', 'output_tokens']);
    const total = this.numberFrom(usage, ['totalTokens', 'total_tokens', 'tokens']);
    const cacheRead = this.numberFrom(usage, ['cachedTokens', 'cacheReadTokens', 'cache_read_input_tokens']);

    if (input === 0 && output === 0 && total === 0 && cacheRead === 0) return undefined;
    const parsed: TokenUsage = {
      input,
      output,
      total: total || input + output + cacheRead,
    };
    if (cacheRead > 0) parsed.cacheRead = cacheRead;
    return parsed;
  }

  private findUsage(value: unknown): JsonObject | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as JsonObject;
    for (const key of ['usage', 'tokenUsage', 'token_usage', 'metadata']) {
      const candidate = obj[key];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        const nested = this.findUsage(candidate);
        return nested || (candidate as JsonObject);
      }
    }
    return null;
  }

  private unwrapJson(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const obj = value as JsonObject;
    return obj.data ?? obj.session ?? obj.chat ?? value;
  }

  private stringFrom(value: unknown, keys: string[]): string {
    if (!value || typeof value !== 'object') return '';
    const obj = value as JsonObject;
    for (const key of keys) {
      const candidate = obj[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
  }

  private numberFrom(obj: JsonObject, keys: string[]): number {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return 0;
  }
}
