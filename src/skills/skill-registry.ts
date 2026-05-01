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
