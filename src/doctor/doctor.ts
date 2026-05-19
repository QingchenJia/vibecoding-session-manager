import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { detectPlatform } from '../utils/platform.js';
import type { AgentType } from '../types.js';
import { getAgentDisplayName } from '../ui/display.js';

export interface AgentCheckResult {
  agent: AgentType;
  displayName: string;
  checks: CheckItem[];
  issues: string[];
}

export interface CheckItem {
  label: string;
  status: 'ok' | 'warning' | 'error' | 'info';
  detail: string;
}

export class Doctor {
  private platform = detectPlatform();
  private home = this.platform.homeDir;

  async runAll(): Promise<AgentCheckResult[]> {
    return [
      await this.checkCC(),
      await this.checkCodex(),
      await this.checkCopilot(),
      await this.checkReasonix(),
      await this.checkOpenCode(),
      await this.checkGemini(),
    ];
  }

  // ─── Claude Code ─────────────────────────────────────────────────

  private async checkCC(): Promise<AgentCheckResult> {
    const issues: string[] = [];
    const checks: CheckItem[] = [];
    const projectsDir = path.join(this.home, '.claude', 'projects');

    // Sessions path
    const projectsExists = await this.dirExists(projectsDir);
    checks.push({
      label: 'Sessions path',
      status: projectsExists ? 'ok' : 'error',
      detail: projectsDir,
    });

    let sessionCount = 0;
    if (projectsExists) {
      try {
        const entries = await fs.readdir(projectsDir);
        for (const entry of entries) {
          if (entry === 'memory') continue;
          const ep = path.join(projectsDir, entry);
          if (!(await this.dirExists(ep))) continue;
          const files = await fs.readdir(ep);
          const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
          for (const f of jsonlFiles) {
            const stat = await fs.stat(path.join(ep, f)).catch(() => null);
            if (stat && stat.size === 0) {
              issues.push(`Empty session file: ${path.join(entry, f)}`);
            } else if (stat) {
              sessionCount++;
            }
          }
        }
      } catch {
        issues.push('Cannot read sessions directory');
      }
      checks.push({
        label: 'Sessions',
        status: sessionCount > 0 ? 'ok' : 'info',
        detail: String(sessionCount),
      });
    }

    // Skills path
    const skillsDir = path.join(this.home, '.claude', 'skills');
    const skillsExists = await this.dirExists(skillsDir);
    let skillCount = 0;
    if (skillsExists) {
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        skillCount = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
      } catch { /* skip */ }
    }
    checks.push({
      label: 'Skills path',
      status: skillsExists ? 'ok' : 'warning',
      detail: skillsExists ? `${skillsDir} (${skillCount} skills)` : `${skillsDir} (not found)`,
    });

    // Permissions
    const canWrite = await this.canWrite(projectsExists ? projectsDir : this.home);
    checks.push({
      label: 'Permissions',
      status: canWrite ? 'ok' : 'error',
      detail: canWrite ? 'read/write' : 'read-only',
    });

    return { agent: 'claude', displayName: getAgentDisplayName('claude'), checks, issues };
  }

  // ─── Codex ────────────────────────────────────────────────────────

  private async checkCodex(): Promise<AgentCheckResult> {
    const issues: string[] = [];
    const checks: CheckItem[] = [];
    const codexDir = path.join(this.home, '.codex');

    // Session index
    const indexPath = path.join(codexDir, 'session_index.jsonl');
    const indexExists = await this.fileExists(indexPath);
    let sessionCount = 0;
    if (indexExists) {
      try {
        const content = await fs.readFile(indexPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try { JSON.parse(line); sessionCount++; } catch {
            issues.push(`Invalid JSONL line in session_index.jsonl`);
          }
        }
        checks.push({ label: 'Session index', status: 'ok', detail: indexPath });
        checks.push({ label: 'Sessions', status: sessionCount > 0 ? 'ok' : 'info', detail: String(sessionCount) });
      } catch {
        checks.push({ label: 'Session index', status: 'error', detail: `${indexPath} (unreadable)` });
        issues.push('Cannot read session_index.jsonl');
      }
    } else {
      checks.push({ label: 'Session index', status: 'info', detail: `${indexPath} (not found)` });
    }

    // SQLite DB
    const stateDbPath = path.join(codexDir, 'state_5.sqlite');
    const dbExists = await this.fileExists(stateDbPath);
    let threadCount = 0;
    if (dbExists) {
      try {
        const db = new Database(stateDbPath);
        const row = db.prepare('SELECT count(*) as cnt FROM threads').get() as { cnt: number };
        threadCount = row.cnt;
        db.close();

        // Check for orphan rollout paths
        if (threadCount > 0) {
          const db2 = new Database(stateDbPath);
          const threads = db2.prepare('SELECT id, rollout_path FROM threads').all() as Array<{ id: string; rollout_path: string }>;
          db2.close();
          for (const t of threads) {
            const rp = path.join(codexDir, t.rollout_path);
            if (!(await this.fileExists(rp))) {
              issues.push(`Orphan rollout path for thread ${t.id.slice(0, 8)}: ${t.rollout_path}`);
            }
          }
        }
        checks.push({ label: 'SQLite DB', status: 'ok', detail: `${stateDbPath} (${threadCount} threads)` });
      } catch {
        checks.push({ label: 'SQLite DB', status: 'error', detail: `${stateDbPath} (cannot open)` });
        issues.push('Cannot open state_5.sqlite');
      }
    } else {
      checks.push({ label: 'SQLite DB', status: 'info', detail: `${stateDbPath} (not found)` });
    }

    // Sessions directory — check for orphan rollout files
    const sessionsDir = path.join(codexDir, 'sessions');
    const sessionsDirExists = await this.dirExists(sessionsDir);
    let rolloutCount = 0;
    if (sessionsDirExists) {
      const files = await this.findFilesRecursive(sessionsDir, '.jsonl');
      rolloutCount = files.length;
      checks.push({
        label: 'Sessions dir',
        status: rolloutCount > 0 ? 'ok' : 'info',
        detail: `${sessionsDir} (${rolloutCount} rollout files)`,
      });

      // Check for orphan rollout files
      if (rolloutCount > 0) {
        const knownPaths = new Set<string>();
        if (threadCount > 0) {
          try {
            const db = new Database(stateDbPath);
            const allThreads = db.prepare('SELECT rollout_path FROM threads').all() as Array<{ rollout_path: string }>;
            db.close();
            for (const t of allThreads) knownPaths.add(t.rollout_path);
          } catch { /* skip */ }
        }
        for (const f of files) {
          const rel = path.relative(codexDir, f).replace(/\\/g, '/');
          if (!knownPaths.has(rel)) {
            issues.push(`Orphan rollout file: ${rel}`);
          }
        }
      }
    } else {
      checks.push({ label: 'Sessions dir', status: 'info', detail: `${sessionsDir} (not found)` });
    }

    // Skills
    const skillsDir = path.join(codexDir, 'skills');
    const skillsExists = await this.dirExists(skillsDir);
    let skillCount = 0;
    if (skillsExists) {
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        skillCount = entries.filter((e) => e.isDirectory() && e.name !== '.system' && !e.name.startsWith('.')).length;
      } catch { /* skip */ }
    }
    checks.push({
      label: 'Skills path',
      status: skillsExists ? 'ok' : 'warning',
      detail: skillsExists ? `${skillsDir} (${skillCount} skills)` : `${skillsDir} (not found)`,
    });

    // Permissions
    const canWrite = await this.canWrite(codexDir);
    checks.push({
      label: 'Permissions',
      status: canWrite ? 'ok' : 'error',
      detail: canWrite ? 'read/write' : 'read-only',
    });

    return { agent: 'codex', displayName: getAgentDisplayName('codex'), checks, issues };
  }

  // ─── Copilot ──────────────────────────────────────────────────────

  private async checkCopilot(): Promise<AgentCheckResult> {
    const issues: string[] = [];
    const checks: CheckItem[] = [];

    // Workspace storage
    const wsDir = this.copilotWorkspaceDir;
    const wsExists = wsDir ? await this.dirExists(wsDir) : false;
    let sessionCount = 0;
    if (wsExists && wsDir) {
      try {
        const entries = await fs.readdir(wsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const hashDir = path.join(wsDir, entry.name);
          const chatSessions = path.join(hashDir, 'chatSessions');
          const transcripts = path.join(hashDir, 'GitHub.copilot-chat', 'transcripts');
          const csFiles = await this.countJsonlFiles(chatSessions);
          const trFiles = await this.countJsonlFiles(transcripts);
          sessionCount += csFiles + trFiles;
        }
        checks.push({ label: 'Workspace storage', status: 'ok', detail: wsDir });
        checks.push({ label: 'Sessions', status: sessionCount > 0 ? 'ok' : 'info', detail: String(sessionCount) });
      } catch {
        checks.push({ label: 'Workspace storage', status: 'error', detail: `${wsDir} (unreadable)` });
        issues.push('Cannot read workspace storage');
      }
    } else {
      checks.push({ label: 'Workspace storage', status: 'info', detail: `${wsDir || '(unknown)'} (not found)` });
    }

    // Skills path
    const skillsDir = path.join(this.home, '.copilot', 'skills');
    const skillsExists = await this.dirExists(skillsDir);
    let skillCount = 0;
    if (skillsExists) {
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        skillCount = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
      } catch { /* skip */ }
    }
    checks.push({
      label: 'Skills path',
      status: skillsExists ? 'ok' : 'warning',
      detail: skillsExists ? `${skillsDir} (${skillCount} skills)` : `${skillsDir} (not found)`,
    });

    // Permissions
    const checkDir = wsExists && wsDir ? wsDir : this.home;
    const canWrite = await this.canWrite(checkDir);
    checks.push({
      label: 'Permissions',
      status: canWrite ? 'ok' : 'error',
      detail: canWrite ? 'read/write' : 'read-only',
    });

    return { agent: 'copilot', displayName: getAgentDisplayName('copilot'), checks, issues };
  }

  // ─── Reasonix ─────────────────────────────────────────────────────

  private async checkReasonix(): Promise<AgentCheckResult> {
    const issues: string[] = [];
    const checks: CheckItem[] = [];
    const reasonixDir = path.join(this.home, '.reasonix');

    const reasonixExists = await this.dirExists(reasonixDir);
    checks.push({
      label: 'Config path',
      status: reasonixExists ? 'ok' : 'info',
      detail: reasonixExists ? reasonixDir : `${reasonixDir} (not found)`,
    });

    let sessionCount = 0;
    for (const dirName of ['session-state', 'sessions', 'transcripts']) {
      const dir = path.join(reasonixDir, dirName);
      const files = await this.findFilesRecursive(dir, '.jsonl');
      sessionCount += files.length;
      for (const file of files) {
        const stat = await fs.stat(file).catch(() => null);
        if (stat && stat.size === 0) {
          issues.push(`Empty Reasonix session file: ${path.relative(reasonixDir, file).replace(/\\/g, '/')}`);
        }
      }
    }
    checks.push({
      label: 'Sessions',
      status: sessionCount > 0 ? 'ok' : 'info',
      detail: String(sessionCount),
    });

    const skillsDir = path.join(reasonixDir, 'skills');
    const skillsExists = await this.dirExists(skillsDir);
    let skillCount = 0;
    if (skillsExists) {
      try {
        const entries = await fs.readdir(skillsDir, { withFileTypes: true });
        skillCount = entries.filter((e) => {
          if (e.name.startsWith('.')) return false;
          return e.isDirectory() || (e.isFile() && e.name.endsWith('.md'));
        }).length;
      } catch { /* skip */ }
    }
    checks.push({
      label: 'Skills path',
      status: skillsExists ? 'ok' : 'warning',
      detail: skillsExists ? `${skillsDir} (${skillCount} skills)` : `${skillsDir} (not found)`,
    });

    const canWrite = await this.canWrite(reasonixExists ? reasonixDir : this.home);
    checks.push({
      label: 'Permissions',
      status: canWrite ? 'ok' : 'error',
      detail: canWrite ? 'read/write' : 'read-only',
    });

    return { agent: 'reasonix', displayName: getAgentDisplayName('reasonix'), checks, issues };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async checkOpenCode(): Promise<AgentCheckResult> {
    const issues: string[] = [];
    const checks: CheckItem[] = [];
    const dataDir = process.env.OPENCODE_DATA_DIR || path.join(this.home, '.local', 'share', 'opencode');

    const dataExists = await this.dirExists(dataDir);
    checks.push({
      label: 'Data path',
      status: dataExists ? 'ok' : 'info',
      detail: dataExists ? dataDir : `${dataDir} (not found)`,
    });

    let sessionCount = 0;
    const dbPath = path.join(dataDir, 'opencode.db');
    if (await this.fileExists(dbPath)) {
      try {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const row = db.prepare('SELECT count(*) as count FROM session').get() as { count: number };
        sessionCount += row.count;
        db.close();
        checks.push({ label: 'SQLite DB', status: 'ok', detail: `${dbPath} (${row.count} sessions)` });
      } catch {
        checks.push({ label: 'SQLite DB', status: 'error', detail: `${dbPath} (cannot open)` });
        issues.push('Cannot open OpenCode SQLite database');
      }
    } else {
      checks.push({ label: 'SQLite DB', status: 'info', detail: `${dbPath} (not found)` });
    }

    const projectDir = path.join(dataDir, 'project');
    const jsonSessions = await this.findFilesRecursive(projectDir, '.json');
    const storageSessions = jsonSessions.filter((file) => file.replace(/\\/g, '/').includes('/storage/session/'));
    sessionCount += storageSessions.length;
    checks.push({
      label: 'Storage sessions',
      status: storageSessions.length > 0 ? 'ok' : 'info',
      detail: `${projectDir} (${storageSessions.length} JSON sessions)`,
    });
    checks.push({ label: 'Sessions', status: sessionCount > 0 ? 'ok' : 'info', detail: String(sessionCount) });

    const skillsDir = path.join(this.home, '.config', 'opencode', 'skills');
    const skillsExists = await this.dirExists(skillsDir);
    checks.push({
      label: 'Skills path',
      status: skillsExists ? 'ok' : 'warning',
      detail: skillsExists ? `${skillsDir} (${await this.countSkillDirs(skillsDir)} skills)` : `${skillsDir} (not found)`,
    });

    const canWrite = await this.canWrite(dataExists ? dataDir : this.home);
    checks.push({
      label: 'Permissions',
      status: canWrite ? 'ok' : 'error',
      detail: canWrite ? 'read/write' : 'read-only',
    });

    return { agent: 'opencode', displayName: getAgentDisplayName('opencode'), checks, issues };
  }

  private async checkGemini(): Promise<AgentCheckResult> {
    const issues: string[] = [];
    const checks: CheckItem[] = [];
    const geminiDir = path.join(this.home, '.gemini');
    const tmpDir = path.join(geminiDir, 'tmp');

    const geminiExists = await this.dirExists(geminiDir);
    checks.push({
      label: 'Config path',
      status: geminiExists ? 'ok' : 'info',
      detail: geminiExists ? geminiDir : `${geminiDir} (not found)`,
    });

    const files = await this.findFilesRecursive(tmpDir, '.json');
    const sessionFiles = files.filter((file) => {
      const normalized = file.replace(/\\/g, '/');
      return path.basename(file) !== 'logs.json' && (normalized.includes('/chats/') || normalized.includes('/checkpoint'));
    });
    for (const file of sessionFiles) {
      const stat = await fs.stat(file).catch(() => null);
      if (stat && stat.size === 0) {
        issues.push(`Empty Gemini session file: ${path.relative(geminiDir, file).replace(/\\/g, '/')}`);
      }
    }
    checks.push({
      label: 'Sessions',
      status: sessionFiles.length > 0 ? 'ok' : 'info',
      detail: `${tmpDir} (${sessionFiles.length} JSON sessions)`,
    });

    const skillsDir = path.join(geminiDir, 'skills');
    const skillsExists = await this.dirExists(skillsDir);
    checks.push({
      label: 'Skills path',
      status: skillsExists ? 'ok' : 'warning',
      detail: skillsExists ? `${skillsDir} (${await this.countSkillDirs(skillsDir)} skills)` : `${skillsDir} (not found)`,
    });

    const canWrite = await this.canWrite(geminiExists ? geminiDir : this.home);
    checks.push({
      label: 'Permissions',
      status: canWrite ? 'ok' : 'error',
      detail: canWrite ? 'read/write' : 'read-only',
    });

    return { agent: 'gemini', displayName: getAgentDisplayName('gemini'), checks, issues };
  }

  private get copilotWorkspaceDir(): string | null {
    if (this.platform.isWindows && this.platform.appData) {
      return path.join(this.platform.appData, 'Code', 'User', 'workspaceStorage');
    }
    if (this.platform.isMacOS) {
      return path.join(this.platform.darwinUserSupport, 'Code', 'User', 'workspaceStorage');
    }
    if (this.platform.xdgConfigHome) {
      return path.join(this.platform.xdgConfigHome, 'Code', 'User', 'workspaceStorage');
    }
    return null;
  }

  private async dirExists(p: string): Promise<boolean> {
    try { return (await fs.stat(p)).isDirectory(); } catch { return false; }
  }

  private async fileExists(p: string): Promise<boolean> {
    try { return (await fs.stat(p)).isFile(); } catch { return false; }
  }

  private async canWrite(p: string): Promise<boolean> {
    try { await fs.access(p, fs.constants.W_OK); return true; } catch { return false; }
  }

  private async countJsonlFiles(dir: string): Promise<number> {
    try {
      const files = await fs.readdir(dir);
      return files.filter((f) => f.endsWith('.jsonl') || f.endsWith('.json')).length;
    } catch { return 0; }
  }

  private async countSkillDirs(dir: string): Promise<number> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).length;
    } catch { return 0; }
  }

  private async findFilesRecursive(dir: string, ext: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...(await this.findFilesRecursive(fullPath, ext)));
        } else if (entry.name.endsWith(ext)) {
          results.push(fullPath);
        }
      }
    } catch { /* skip */ }
    return results;
  }
}
