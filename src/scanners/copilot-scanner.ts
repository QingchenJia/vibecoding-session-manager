import fs from 'node:fs/promises';
import path from 'node:path';
import { CursorScanner } from './cursor-scanner.js';
import type { Session, AgentType } from '../types.js';

export class CopilotScanner extends CursorScanner {
  readonly agent: AgentType = 'copilot';

  getDisplayName(): string {
    return 'GitHub Copilot';
  }

  protected override get workspaceStorageDir(): string | null {
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

  override async discover(): Promise<Session[]> {
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

    const seenIds = new Set(sessions.map((s) => s.id));

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

      for (const filePath of transcriptFiles) {
        const stats = await this.getFileStats(filePath);
        if (stats.size === 0) continue;

        const filename = path.basename(filePath, path.extname(filePath));
        const id = `${hash}-copilot-${filename}`;
        if (seenIds.has(id)) continue;

        sessions.push({
          id,
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
}
