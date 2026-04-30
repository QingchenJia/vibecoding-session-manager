import path from 'node:path';
import { CursorScanner } from './cursor-scanner.js';
import type { Session, AgentType } from '../types.js';

export class WindsurfScanner extends CursorScanner {
  readonly agent: AgentType = 'windsurf';

  getDisplayName(): string {
    return 'Windsurf';
  }

  protected override get workspaceStorageDir(): string | null {
    if (this.platform.isWindows) {
      return this.platform.appData
        ? path.join(this.platform.appData, 'Windsurf', 'User', 'workspaceStorage')
        : null;
    }
    if (this.platform.isMacOS) {
      return path.join(
        this.platform.darwinUserSupport,
        'Windsurf',
        'User',
        'workspaceStorage',
      );
    }
    return path.join(
      this.platform.xdgConfigHome!,
      'Windsurf',
      'User',
      'workspaceStorage',
    );
  }

  override async discover(): Promise<Session[]> {
    const wsDir = this.workspaceStorageDir;
    if (!wsDir || !(await this.dirExists(wsDir))) return [];
    return this.scanWorkspaceStorage(wsDir, 'windsurf');
  }
}
