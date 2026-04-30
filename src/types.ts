export type AgentType = 'claude-code' | 'cursor' | 'copilot' | 'windsurf';

export interface Session {
  id: string;
  name: string;
  agent: AgentType;
  path: string;
  lastModified: number;
  size: number;
}

export interface SessionGroup {
  agent: AgentType;
  sessions: Session[];
}

export interface IScanner {
  readonly agent: AgentType;
  getDisplayName(): string;
  discover(): Promise<Session[]>;
  delete(session: Session): Promise<boolean>;
}

export interface PlatformInfo {
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  homeDir: string;
  appData: string | null;
  localAppData: string | null;
  darwinUserSupport: string;
  xdgDataHome: string | null;
  xdgConfigHome: string | null;
}
