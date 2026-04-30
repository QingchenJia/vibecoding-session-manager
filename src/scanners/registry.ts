import type { IScanner, Session, SessionGroup, AgentType } from '../types.js';
import { ClaudeCodeScanner } from './claude-code-scanner.js';
import { CursorScanner } from './cursor-scanner.js';
import { CopilotScanner } from './copilot-scanner.js';
import { WindsurfScanner } from './windsurf-scanner.js';
import { CodexScanner } from './codex-scanner.js';

export class ScannerRegistry {
  private scanners: Map<AgentType, IScanner> = new Map();

  constructor() {
    this.register(new ClaudeCodeScanner());
    this.register(new CursorScanner());
    this.register(new CopilotScanner());
    this.register(new WindsurfScanner());
    this.register(new CodexScanner());
  }

  register(scanner: IScanner): void {
    this.scanners.set(scanner.agent, scanner);
  }

  get(agent: AgentType): IScanner | undefined {
    return this.scanners.get(agent);
  }

  getAll(): IScanner[] {
    return Array.from(this.scanners.values());
  }

  async discoverAll(): Promise<SessionGroup[]> {
    const groups: SessionGroup[] = [];
    for (const scanner of this.getAll()) {
      const sessions = await scanner.discover();
      if (sessions.length > 0) {
        groups.push({ agent: scanner.agent, sessions });
      }
    }
    return groups;
  }

  async discoverByAgent(agent: AgentType): Promise<Session[]> {
    const scanner = this.scanners.get(agent);
    if (!scanner) return [];
    return scanner.discover();
  }
}
