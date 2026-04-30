import { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IScanner, Session, AgentType, PlatformInfo } from '../types.js';
import { detectPlatform } from '../utils/platform.js';

export abstract class BaseScanner implements IScanner {
  abstract readonly agent: AgentType;
  protected platform: PlatformInfo;

  constructor() {
    this.platform = detectPlatform();
  }

  abstract getDisplayName(): string;
  abstract discover(): Promise<Session[]>;
  abstract delete(session: Session): Promise<boolean>;

  protected async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(dirPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  protected async fileExists(filePath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(filePath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  protected async readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch {
      return null;
    }
  }

  protected async findFilesRecursive(
    root: string,
    extensions: string[],
    maxDepth = 5,
  ): Promise<string[]> {
    const results: string[] = [];
    const extSet = new Set(extensions.map((e) => e.toLowerCase()));

    async function walk(dir: string, depth: number) {
      if (depth > maxDepth) return;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extSet.has(ext)) {
            results.push(fullPath);
          }
        }
      }
    }

    await walk(root, 0);
    return results;
  }

  protected async getFileStats(
    filePath: string,
  ): Promise<{ mtime: number; size: number }> {
    try {
      const stat = await fs.stat(filePath);
      return { mtime: stat.mtimeMs, size: stat.size };
    } catch {
      return { mtime: 0, size: 0 };
    }
  }
}
