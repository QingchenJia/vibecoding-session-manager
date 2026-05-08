export type AgentType = 'cc' | 'copilot' | 'codex';

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

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
  cacheRead?: number;
}

export interface SessionDetail {
  session: Session;
  messageCount?: number;
  firstUserMessage?: string;
  lastUserMessage?: string;
  preview?: string[];
  rawFiles?: string[];
  tokenUsage?: TokenUsage;
}

export interface IScanner {
  readonly agent: AgentType;
  getDisplayName(): string;
  discover(): Promise<Session[]>;
  delete(session: Session): Promise<boolean>;
  inspect?(session: Session): Promise<SessionDetail>;
}

export interface SearchResult {
  session: Session;
  matches: SearchMatch[];
}

export interface SearchMatch {
  line: number;
  content: string;
  snippet: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  registeredIn: AgentType[];
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
