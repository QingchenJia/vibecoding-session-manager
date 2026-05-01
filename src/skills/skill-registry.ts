import fs from 'node:fs/promises';
import path from 'node:path';
import { detectPlatform } from '../utils/platform.js';
import type { AgentType, SkillInfo } from '../types.js';

interface AgentSkillConfig {
  skillsDir: string;
  /** Subdirectory name containing built-in skills, or null if none */
  builtinSubdir: string | null;
}

function parseFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = match[1];
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (!name) return null;
  return { name, description: description || '' };
}

export class SkillRegistry {
  private agents: AgentType[] = [];
  private configs = new Map<AgentType, AgentSkillConfig>();

  constructor() {
    const platform = detectPlatform();
    const home = platform.homeDir;

    this.addAgent('cc', path.join(home, '.claude', 'skills'), null);
    this.addAgent('codex', path.join(home, '.codex', 'skills'), '.system');
    this.addAgent('copilot', path.join(home, '.copilot', 'skills'), null);
  }

  private addAgent(agent: AgentType, skillsDir: string, builtinSubdir: string | null): void {
    this.agents.push(agent);
    this.configs.set(agent, { skillsDir, builtinSubdir });
  }

  getKnownAgents(): AgentType[] {
    return [...this.agents];
  }

  async discoverAll(): Promise<SkillInfo[]> {
    const skillMap = new Map<string, AgentType[]>();
    const descMap = new Map<string, string>();

    for (const agent of this.agents) {
      const config = this.configs.get(agent)!;
      let entries: string[];

      try {
        const all = await fs.readdir(config.skillsDir, { withFileTypes: true });
        entries = all
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          .filter((name) => {
            if (name.startsWith('.')) return false;
            if (config.builtinSubdir && name === config.builtinSubdir) return false;
            return true;
          });
      } catch {
        continue; // skills dir doesn't exist for this agent
      }

      for (const entry of entries) {
        const registered = skillMap.get(entry) || [];
        registered.push(agent);
        skillMap.set(entry, registered);

        if (!descMap.has(entry)) {
          const mdPath = path.join(config.skillsDir, entry, 'SKILL.md');
          try {
            const content = await fs.readFile(mdPath, 'utf-8');
            const fm = parseFrontmatter(content);
            descMap.set(entry, fm?.description || '');
          } catch {
            descMap.set(entry, '');
          }
        }
      }

      // Also check builtin subdir for skills that might have been installed there
      // (Codex puts system skills in .system/ but user-installed plugins go to root)
    }

    const result: SkillInfo[] = [];
    for (const [name, registeredIn] of skillMap) {
      result.push({
        name,
        description: descMap.get(name) || '',
        registeredIn,
      });
    }

    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /** Find which agents have a given skill, and the source path for copying */
  async findSkill(
    skillName: string,
  ): Promise<{ agents: AgentType[]; sourceAgent: AgentType; sourcePath: string } | null> {
    const agents: AgentType[] = [];
    let sourcePath = '';

    for (const agent of this.agents) {
      const config = this.configs.get(agent)!;
      const skillDir = path.join(config.skillsDir, skillName);
      try {
        await fs.access(skillDir);
        agents.push(agent);
        if (!sourcePath) {
          sourcePath = skillDir;
        }
      } catch {
        // agent doesn't have this skill
      }
    }

    if (agents.length === 0) return null;
    // sourceAgent is the first one found; caller can override with --from
    return { agents, sourceAgent: agents[0], sourcePath };
  }

  async register(skillName: string, toAgent: AgentType, fromAgent?: AgentType): Promise<{
    success: boolean;
    message: string;
  }> {
    const config = this.configs.get(toAgent);
    if (!config) {
      return { success: false, message: `Unknown agent: ${toAgent}` };
    }

    const destPath = path.join(config.skillsDir, skillName);

    // Check if already registered
    try {
      await fs.access(destPath);
      return { success: false, message: `Skill "${skillName}" is already registered in ${toAgent}` };
    } catch {
      // expected — not yet registered
    }

    // Find source
    let sourcePath: string | null = null;

    if (fromAgent) {
      const srcConfig = this.configs.get(fromAgent);
      if (!srcConfig) {
        return { success: false, message: `Unknown source agent: ${fromAgent}` };
      }
      sourcePath = path.join(srcConfig.skillsDir, skillName);
      try {
        await fs.access(sourcePath);
      } catch {
        return {
          success: false,
          message: `Skill "${skillName}" not found in ${fromAgent}`,
        };
      }
    } else {
      const found = await this.findSkill(skillName);
      if (!found) {
        return { success: false, message: `Skill "${skillName}" not found in any agent` };
      }
      sourcePath = found.sourcePath;
    }

    // Ensure destination directory exists
    try {
      await fs.mkdir(config.skillsDir, { recursive: true });
    } catch {
      return { success: false, message: `Cannot create skills directory for ${toAgent}` };
    }

    // Recursive copy
    try {
      await this.copyDir(sourcePath, destPath);
      return { success: true, message: `Registered "${skillName}" to ${toAgent}` };
    } catch (err) {
      return {
        success: false,
        message: `Copy failed: ${(err as Error).message}`,
      };
    }
  }

  async deregister(skillName: string, fromAgent: AgentType): Promise<{
    success: boolean;
    message: string;
  }> {
    const config = this.configs.get(fromAgent);
    if (!config) {
      return { success: false, message: `Unknown agent: ${fromAgent}` };
    }

    const skillPath = path.join(config.skillsDir, skillName);
    try {
      await fs.access(skillPath);
    } catch {
      return { success: false, message: `Skill "${skillName}" is not registered in ${fromAgent}` };
    }

    try {
      await fs.rm(skillPath, { recursive: true, force: true });
      return { success: true, message: `Deregistered "${skillName}" from ${fromAgent}` };
    } catch (err) {
      return { success: false, message: `Delete failed: ${(err as Error).message}` };
    }
  }

  async inspect(skillName: string): Promise<{
    skillName: string;
    description: string;
    registeredIn: AgentType[];
    paths: Record<string, string>;
    files: Record<string, string[]>;
  } | null> {
    const registeredIn: AgentType[] = [];
    const paths: Record<string, string> = {};
    const files: Record<string, string[]> = {};
    let description = '';

    for (const agent of this.agents) {
      const config = this.configs.get(agent)!;
      const skillDir = path.join(config.skillsDir, skillName);
      try {
        await fs.access(skillDir);
        registeredIn.push(agent);
        paths[agent] = skillDir;

        // Read SKILL.md for description
        const mdPath = path.join(skillDir, 'SKILL.md');
        try {
          const content = await fs.readFile(mdPath, 'utf-8');
          const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fm) {
            const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
            if (desc && !description) description = desc;
          }
        } catch { /* skip */ }

        // List files
        const fileList: string[] = [];
        await this.listFiles(skillDir, skillDir, fileList);
        files[agent] = fileList;
      } catch {
        // not registered in this agent
      }
    }

    if (registeredIn.length === 0) return null;
    return { skillName, description, registeredIn, paths, files };
  }

  async diff(
    skillName: string,
    agentA: AgentType,
    agentB: AgentType,
  ): Promise<{
    skillName: string;
    agentA: AgentType;
    agentB: AgentType;
    diffLines: string[];
    onlyInA: string[];
    onlyInB: string[];
  }> {
    const configA = this.configs.get(agentA)!;
    const configB = this.configs.get(agentB)!;
    const dirA = path.join(configA.skillsDir, skillName);
    const dirB = path.join(configB.skillsDir, skillName);

    const diffLines: string[] = [];
    const onlyInA: string[] = [];
    const onlyInB: string[] = [];

    // Compare SKILL.md
    const mdA = await this.readFileSafe(path.join(dirA, 'SKILL.md'));
    const mdB = await this.readFileSafe(path.join(dirB, 'SKILL.md'));

    if (mdA === null && mdB === null) {
      diffLines.push('SKILL.md missing in both agents');
    } else if (mdA === null) {
      diffLines.push('SKILL.md only exists in ' + agentB);
    } else if (mdB === null) {
      diffLines.push('SKILL.md only exists in ' + agentA);
    } else if (mdA !== mdB) {
      diffLines.push('SKILL.md differs');
    }

    // Compare files
    const filesA = new Set<string>();
    const filesB = new Set<string>();
    await this.listFiles(dirA, dirA, []).then((f) => f.forEach((x) => filesA.add(x))).catch(() => {});
    await this.listFiles(dirB, dirB, []).then((f) => f.forEach((x) => filesB.add(x))).catch(() => {});

    for (const f of filesA) {
      if (!filesB.has(f)) onlyInA.push(f);
    }
    for (const f of filesB) {
      if (!filesA.has(f)) onlyInB.push(f);
    }

    if (onlyInA.length === 0 && onlyInB.length === 0) {
      diffLines.push('All files match');
    }

    return { skillName, agentA, agentB, diffLines, onlyInA, onlyInB };
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try { return await fs.readFile(filePath, 'utf-8'); } catch { return null; }
  }

  private async listFiles(baseDir: string, dir: string, result: string[]): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await this.listFiles(baseDir, fullPath, result);
        } else {
          result.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
        }
      }
    } catch { /* skip */ }
    return result;
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
