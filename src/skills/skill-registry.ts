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

    this.addAgent('claude', path.join(home, '.claude', 'skills'), null);
    this.addAgent('codex', path.join(home, '.codex', 'skills'), '.system');
    this.addAgent('copilot', path.join(home, '.copilot', 'skills'), null);
    this.addAgent('reasonix', path.join(home, '.reasonix', 'skills'), null);
    this.addAgent('opencode', path.join(home, '.config', 'opencode', 'skills'), null);
    this.addAgent('gemini', path.join(home, '.gemini', 'skills'), null);
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
          .filter((d) => d.isDirectory() || (d.isFile() && d.name.endsWith('.md')))
          .map((d) => d.isDirectory() ? d.name : d.name.replace(/\.md$/, ''))
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
          const mdPath = await this.getSkillMarkdownPath(config.skillsDir, entry);
          try {
            const content = mdPath ? await fs.readFile(mdPath, 'utf-8') : '';
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
      const skillPath = await this.getSkillPath(config.skillsDir, skillName);
      if (skillPath) {
        agents.push(agent);
        if (!sourcePath) {
          sourcePath = skillPath;
        }
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
      sourcePath = await this.getSkillPath(srcConfig.skillsDir, skillName);
      if (!sourcePath) {
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
      await this.copySkill(sourcePath, destPath);
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

    const skillPath = await this.getSkillPath(config.skillsDir, skillName);
    if (!skillPath) {
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
      const skillPath = await this.getSkillPath(config.skillsDir, skillName);
      if (skillPath) {
        registeredIn.push(agent);
        paths[agent] = skillPath;

        // Read SKILL.md for description
        const mdPath = await this.getSkillMarkdownPath(config.skillsDir, skillName);
        try {
          const content = mdPath ? await fs.readFile(mdPath, 'utf-8') : '';
          const fm = content.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fm) {
            const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
            if (desc && !description) description = desc;
          }
        } catch { /* skip */ }

        // List files
        const fileList: string[] = [];
        const stat = await fs.stat(skillPath);
        if (stat.isDirectory()) {
          await this.listFiles(skillPath, skillPath, fileList);
        } else {
          fileList.push(path.basename(skillPath));
        }
        files[agent] = fileList;
      } else {
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
    const pathA = await this.getSkillPath(configA.skillsDir, skillName);
    const pathB = await this.getSkillPath(configB.skillsDir, skillName);

    const diffLines: string[] = [];
    const onlyInA: string[] = [];
    const onlyInB: string[] = [];

    // Compare SKILL.md
    const mdA = pathA ? await this.readSkillMarkdown(pathA) : null;
    const mdB = pathB ? await this.readSkillMarkdown(pathB) : null;

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
    await this.listSkillFiles(pathA).then((f) => f.forEach((x) => filesA.add(x))).catch(() => {});
    await this.listSkillFiles(pathB).then((f) => f.forEach((x) => filesB.add(x))).catch(() => {});

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

  private async getSkillPath(skillsDir: string, skillName: string): Promise<string | null> {
    const dirPath = path.join(skillsDir, skillName);
    try {
      if ((await fs.stat(dirPath)).isDirectory()) return dirPath;
    } catch { /* skip */ }

    const filePath = path.join(skillsDir, `${skillName}.md`);
    try {
      if ((await fs.stat(filePath)).isFile()) return filePath;
    } catch { /* skip */ }
    return null;
  }

  private async getSkillMarkdownPath(skillsDir: string, skillName: string): Promise<string | null> {
    const skillPath = await this.getSkillPath(skillsDir, skillName);
    if (!skillPath) return null;
    const stat = await fs.stat(skillPath);
    return stat.isDirectory() ? path.join(skillPath, 'SKILL.md') : skillPath;
  }

  private async readSkillMarkdown(skillPath: string): Promise<string | null> {
    try {
      const stat = await fs.stat(skillPath);
      return stat.isDirectory()
        ? this.readFileSafe(path.join(skillPath, 'SKILL.md'))
        : this.readFileSafe(skillPath);
    } catch {
      return null;
    }
  }

  private async listSkillFiles(skillPath: string | null): Promise<string[]> {
    if (!skillPath) return [];
    const stat = await fs.stat(skillPath);
    if (!stat.isDirectory()) return [path.basename(skillPath)];
    return this.listFiles(skillPath, skillPath, []);
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

  private async copySkill(src: string, dest: string): Promise<void> {
    const stat = await fs.stat(src);
    if (stat.isFile()) {
      await fs.mkdir(dest, { recursive: true });
      await fs.copyFile(src, path.join(dest, 'SKILL.md'));
      return;
    }
    await this.copyDir(src, dest);
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
