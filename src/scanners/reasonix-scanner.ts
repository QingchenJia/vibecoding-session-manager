import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { AgentType, Session, SessionDetail, TokenUsage } from '../types.js';

type JsonObject = Record<string, unknown>;

export class ReasonixScanner extends BaseScanner {
  readonly agent: AgentType = 'reasonix';

  getDisplayName(): string {
    return 'Reasonix';
  }

  private get reasonixDir(): string {
    return path.join(this.platform.homeDir, '.reasonix');
  }

  async discover(): Promise<Session[]> {
    if (!(await this.dirExists(this.reasonixDir))) return [];

    const sessionFiles = new Set<string>();
    const candidateDirs = [
      path.join(this.reasonixDir, 'session-state'),
      path.join(this.reasonixDir, 'sessions'),
      path.join(this.reasonixDir, 'transcripts'),
    ];

    for (const dir of candidateDirs) {
      if (await this.dirExists(dir)) {
        const files = await this.findFilesRecursive(dir, ['.jsonl'], 5);
        for (const file of files) {
          if (this.isReasonixSessionFile(file)) sessionFiles.add(file);
        }
      }
    }

    const projectDirs = await this.getConfiguredProjectDirs();
    projectDirs.push(process.cwd());
    for (const projectDir of projectDirs) {
      const localReasonix = path.join(projectDir, '.reasonix');
      if (!(await this.dirExists(localReasonix))) continue;
      const files = await this.findFilesRecursive(localReasonix, ['.jsonl'], 5);
      for (const file of files) {
        if (this.isReasonixSessionFile(file)) sessionFiles.add(file);
      }
    }

    const sessions: Session[] = [];
    for (const filePath of sessionFiles) {
      const stats = await this.getFileStats(filePath);
      if (stats.size === 0) continue;

      sessions.push({
        id: this.getSessionId(filePath),
        name: await this.getSessionName(filePath),
        agent: 'reasonix',
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
    const userMessages: string[] = [];
    const assistantMessages: string[] = [];
    const preview: string[] = [];
    const tokenUsage: TokenUsage = { input: 0, output: 0, total: 0 };

    try {
      const content = await fs.readFile(session.path, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        let entry: JsonObject;
        try { entry = JSON.parse(line) as JsonObject; } catch { continue; }

        const role = this.getRole(entry);
        const text = this.getText(entry);
        if (role === 'user' && text) {
          userMessages.push(text);
          if (preview.length < 10) preview.push(`[user] ${text.slice(0, 120)}`);
        } else if (role === 'assistant' && text) {
          assistantMessages.push(text);
          if (preview.length < 10) preview.push(`[assistant] ${text.slice(0, 120)}`);
        }

        this.addUsage(tokenUsage, entry);
      }

      detail.messageCount = userMessages.length + assistantMessages.length;
      detail.firstUserMessage = userMessages[0];
      detail.lastUserMessage = userMessages[userMessages.length - 1];
      detail.preview = preview;

      if (tokenUsage.input > 0 || tokenUsage.output > 0 || tokenUsage.total > 0) {
        detail.tokenUsage = {
          input: tokenUsage.input,
          output: tokenUsage.output,
          total: tokenUsage.total || tokenUsage.input + tokenUsage.output,
          cacheRead: tokenUsage.cacheRead && tokenUsage.cacheRead > 0 ? tokenUsage.cacheRead : undefined,
          cacheCreate: tokenUsage.cacheCreate && tokenUsage.cacheCreate > 0 ? tokenUsage.cacheCreate : undefined,
        };
      }
    } catch { /* best effort */ }

    return detail;
  }

  async delete(session: Session): Promise<boolean> {
    try {
      if (path.basename(session.path) === 'events.jsonl') {
        await fs.rm(path.dirname(session.path), { recursive: true, force: true });
      } else {
        await fs.unlink(session.path);
      }
      return true;
    } catch {
      return false;
    }
  }

  private isReasonixSessionFile(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/skills/')) return false;
    if (normalized.includes('/node_modules/')) return false;
    return fileName === 'events.jsonl' || fileName.endsWith('.jsonl');
  }

  private getSessionId(filePath: string): string {
    if (path.basename(filePath) === 'events.jsonl') {
      return path.basename(path.dirname(filePath));
    }
    return path.basename(filePath, path.extname(filePath));
  }

  private async getSessionName(filePath: string): Promise<string> {
    const dir = path.dirname(filePath);
    for (const fileName of ['workspace.json', 'metadata.json', 'session.json', 'state.json']) {
      const data = await this.readJsonFile<JsonObject>(path.join(dir, fileName));
      const name = this.extractWorkspaceName(data);
      if (name) return name;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      for (const line of content.split('\n').slice(0, 20)) {
        if (!line.trim()) continue;
        try {
          const name = this.extractWorkspaceName(JSON.parse(line) as JsonObject);
          if (name) return name;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return path.basename(dir);
  }

  private extractWorkspaceName(data: JsonObject | null): string | null {
    if (!data) return null;
    const candidates = [
      data.rootDir,
      data.workspace,
      data.workspacePath,
      data.cwd,
      data.projectPath,
      data.projectDir,
      data.name,
    ];
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) return value;
    }
    const project = data.project as JsonObject | undefined;
    if (project) return this.extractWorkspaceName(project);
    return null;
  }

  private async getConfiguredProjectDirs(): Promise<string[]> {
    const config = await this.readJsonFile<JsonObject>(path.join(this.reasonixDir, 'config.json'));
    if (!config) return [];

    const dirs = new Set<string>();
    const projects = config.projects;
    if (Array.isArray(projects)) {
      for (const project of projects) {
        if (typeof project === 'string') dirs.add(project);
        else {
          const name = this.extractWorkspaceName(project as JsonObject);
          if (name) dirs.add(name);
        }
      }
    } else if (projects && typeof projects === 'object') {
      for (const key of Object.keys(projects as JsonObject)) dirs.add(key);
    }
    return [...dirs];
  }

  private getRole(entry: JsonObject): string | null {
    const role = entry.role ?? (entry.message as JsonObject | undefined)?.role;
    if (typeof role === 'string') return role;
    const type = entry.type;
    if (type === 'user' || type === 'assistant') return type;
    return null;
  }

  private getText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    const obj = value as JsonObject;
    for (const key of ['content', 'text', 'message', 'prompt', 'response']) {
      const text = this.getText(obj[key]);
      if (text) return text;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.getText(item)).filter(Boolean).join(' ');
    }
    return '';
  }

  private addUsage(total: TokenUsage, entry: JsonObject): void {
    const usage = this.findUsage(entry);
    if (!usage) return;

    const input = this.numberFrom(usage, ['input_tokens', 'prompt_tokens', 'promptTokens', 'inputTokens']);
    const output = this.numberFrom(usage, ['output_tokens', 'completion_tokens', 'completionTokens', 'outputTokens']);
    const totalTokens = this.numberFrom(usage, ['total_tokens', 'totalTokens', 'tokens']);
    const cacheRead = this.numberFrom(usage, [
      'cache_read_input_tokens',
      'prompt_cache_hit_tokens',
      'cacheHitTokens',
      'cached_tokens',
    ]);
    const cacheCreate = this.numberFrom(usage, [
      'cache_creation_input_tokens',
      'prompt_cache_miss_tokens',
      'cacheMissTokens',
    ]);

    total.input += input;
    total.output += output;
    total.total += totalTokens || input + output;
    total.cacheRead = (total.cacheRead || 0) + cacheRead;
    total.cacheCreate = (total.cacheCreate || 0) + cacheCreate;
  }

  private findUsage(entry: JsonObject): JsonObject | null {
    for (const key of ['usage', 'tokenUsage', 'tokens', 'cost']) {
      const value = entry[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as JsonObject;
      }
    }
    return null;
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
