import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { Session, AgentType, SessionDetail } from '../types.js';
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

  async inspect(session: Session): Promise<SessionDetail> {
    const detail: SessionDetail = { session };
    try {
      const content = await fs.readFile(session.path, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      detail.rawFiles = [session.path];

      const userMessages: string[] = [];
      const assistantMessages: string[] = [];
      const preview: string[] = [];
      let totalInput = 0;
      let totalOutput = 0;
      let totalCacheRead = 0;
      let totalCacheCreate = 0;
      let prevUsageKey = '';

      for (const line of lines) {
        let entry: Record<string, unknown>;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry.type === 'user' && entry.message) {
          const msg = entry.message as Record<string, unknown>;
          if (msg.role === 'user' && typeof msg.content === 'string') {
            const text = msg.content;
            userMessages.push(text);
            if (preview.length < 10) preview.push(`[user] ${text.slice(0, 120)}`);
          }
        } else if (entry.type === 'assistant' && entry.message) {
          const msg = entry.message as Record<string, unknown>;
          if (msg.role === 'assistant' && Array.isArray(msg.content)) {
            const texts: string[] = [];
            for (const block of msg.content as Array<Record<string, unknown>>) {
              if (block.type === 'text' && typeof block.text === 'string') {
                texts.push(block.text);
              }
            }
            if (texts.length > 0) {
              const combined = texts.join(' ');
              assistantMessages.push(combined);
              if (preview.length < 10) preview.push(`[assistant] ${combined.slice(0, 120)}`);
            }
          }
          const usage = msg.usage as Record<string, unknown> | undefined;
          if (usage) {
            const key = `${usage.input_tokens || 0}|${usage.output_tokens || 0}|${usage.cache_read_input_tokens || 0}|${usage.cache_creation_input_tokens || 0}`;
            if (key !== prevUsageKey) {
              totalInput += (usage.input_tokens as number) || 0;
              totalOutput += (usage.output_tokens as number) || 0;
              totalCacheRead += (usage.cache_read_input_tokens as number) || 0;
              totalCacheCreate += (usage.cache_creation_input_tokens as number) || 0;
              prevUsageKey = key;
            }
          }
        }
      }

      if (totalInput > 0 || totalOutput > 0) {
        detail.tokenUsage = {
          input: totalInput,
          output: totalOutput,
          total: totalInput + totalOutput + totalCacheRead + totalCacheCreate,
          cacheRead: totalCacheRead > 0 ? totalCacheRead : undefined,
          cacheCreate: totalCacheCreate > 0 ? totalCacheCreate : undefined,
        };
      }

      detail.messageCount = userMessages.length + assistantMessages.length;
      detail.firstUserMessage = userMessages[0];
      detail.lastUserMessage = userMessages[userMessages.length - 1];
      detail.preview = preview;
    } catch { /* best effort */ }
    return detail;
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
