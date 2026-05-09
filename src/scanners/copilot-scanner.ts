import fs from 'node:fs/promises';
import path from 'node:path';
import { BaseScanner } from './base-scanner.js';
import type { Session, AgentType, SessionDetail } from '../types.js';

export class CopilotScanner extends BaseScanner {
  readonly agent: AgentType = 'copilot';

  getDisplayName(): string {
    return 'GitHub Copilot';
  }

  private get workspaceStorageDir(): string | null {
    if (this.platform.isWindows) {
      return this.platform.appData
        ? path.join(this.platform.appData, 'Code', 'User', 'workspaceStorage')
        : null;
    }
    if (this.platform.isMacOS) {
      return path.join(
        this.platform.darwinUserSupport,
        'Code',
        'User',
        'workspaceStorage',
      );
    }
    return path.join(
      this.platform.xdgConfigHome!,
      'Code',
      'User',
      'workspaceStorage',
    );
  }

  async discover(): Promise<Session[]> {
    const wsDir = this.workspaceStorageDir;
    if (!wsDir || !(await this.dirExists(wsDir))) return [];

    const sessions = await this.scanWorkspaceStorage(wsDir, 'copilot');

    // Also scan Copilot-specific transcript directories
    let hashes: string[];
    try {
      hashes = await fs.readdir(wsDir);
    } catch {
      return sessions;
    }

    // Track filenames already found in chatSessions per workspace hash to avoid duplicates
    const seenByHash = new Map<string, Set<string>>();
    for (const s of sessions) {
      const dashIdx = s.id.indexOf('-');
      if (dashIdx > 0) {
        const h = s.id.slice(0, dashIdx);
        const fn = s.id.slice(dashIdx + 1);
        if (!seenByHash.has(h)) seenByHash.set(h, new Set());
        seenByHash.get(h)!.add(fn);
      }
    }

    for (const hash of hashes) {
      const copilotTranscriptDir = path.join(
        wsDir,
        hash,
        'GitHub.copilot-chat',
        'transcripts',
      );
      if (!(await this.dirExists(copilotTranscriptDir))) continue;

      const workspaceJson = await this.readJsonFile<{ folder?: string }>(
        path.join(wsDir, hash, 'workspace.json'),
      );
      const workspaceName = workspaceJson?.folder
        ? decodeURIComponent(
            workspaceJson.folder
              .replace(/^file:\/\/\//, '')
              .replace(/^file:\/\//, ''),
          )
        : `Untitled (${hash.slice(0, 8)})`;

      const transcriptFiles = await this.findFilesRecursive(
        copilotTranscriptDir,
        ['.jsonl', '.json'],
        3,
      );

      const hashSeen = seenByHash.get(hash);
      for (const filePath of transcriptFiles) {
        const stats = await this.getFileStats(filePath);
        if (stats.size === 0) continue;

        const filename = path.basename(filePath, path.extname(filePath));
        // Skip if the same session file already exists in chatSessions
        if (hashSeen?.has(filename)) continue;

        sessions.push({
          id: `${hash}-copilot-${filename}`,
          name: workspaceName,
          agent: 'copilot',
          path: filePath,
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
    detail.rawFiles = [session.path];

    try {
      const content = await fs.readFile(session.path, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());
      const preview: string[] = [];
      let userCount = 0;
      let assistantCount = 0;

      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const role = e.role as string;
          const text = e.content as string;
          if (role === 'user' && text) {
            userCount++;
            if (!detail.firstUserMessage) detail.firstUserMessage = text;
            detail.lastUserMessage = text;
            if (preview.length < 10) preview.push(`[user] ${text.slice(0, 120)}`);
          } else if (role === 'assistant' && text) {
            assistantCount++;
            if (preview.length < 10) preview.push(`[assistant] ${text.slice(0, 120)}`);
          }
        } catch { continue; }
      }

      detail.messageCount = userCount + assistantCount;
      detail.preview = preview;
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

  private async scanWorkspaceStorage(
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
}
