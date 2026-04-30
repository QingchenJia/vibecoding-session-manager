# VibeCoding Session Manager

A terminal tool to manage AI coding agent sessions — list, inspect, and delete conversations from **Claude Code**, **Codex (OpenAI)**, **Cursor**, **GitHub Copilot**, and **Windsurf**.

### Motivation

AI coding agents accumulate session files on disk over time. These files — conversation transcripts, context data, and logs — can grow to hundreds of megabytes and are never cleaned up automatically. This tool gives you a unified interface to browse, measure, and delete them across all agents.

### Installation

```bash
git clone https://github.com/QingchenJia/vibecoding-session-manager.git
cd vibecoding-session-manager
npm install -g .
```

`npm install -g .` installs the package globally from the current directory. It automatically:
1. Runs `tsc` (via the `prepare` script) to compile TypeScript
2. Creates `vibe` / `vibe.cmd` wrappers in the global npm bin directory (which is already in your `PATH`)
3. No manual environment variable configuration needed

After installation, the `vibe` command works from any terminal, any directory.

**Requirements:** Node.js >= 18

### Commands

#### `vibe list` — List all sessions grouped by agent

```bash
vibe list                        # show all agents
vibe list --agent claude-code    # filter by specific agent
vibe list --agent codex          # only Codex sessions
vibe list --json                 # machine-readable JSON output
```

Output shows session ID (first 8 chars), project name, last activity time, and file size per session, grouped and color-coded by agent.

#### `vibe delete` — Interactive session deletion (core feature)

Two-stage interactive flow:
1. **Choose an agent** from the list (or "All agents")
2. **Multi-select sessions** with checkboxes (space to toggle, type to filter, enter to confirm)
3. **Confirm** — shows count and total size to be freed
4. **Execute** with per-session progress feedback

```bash
vibe delete                        # interactive multi-select across all agents
vibe delete --agent copilot        # filter to Copilot first, then interactive
vibe delete --all --agent codex    # delete ALL Codex sessions at once (with confirmation)
vibe delete --all --agent copilot  # delete ALL Copilot sessions at once
vibe delete --all                  # delete ALL sessions from ALL agents (double-confirms)
```

#### `vibe delete-id` — Delete a specific session by its ID

Useful for scripting or when you know the exact session ID from `vibe list --json`:

```bash
vibe delete-id b68c4922-9707-4fb6-bd60-5e4a56087c58 -a claude-code
```

#### `vibe prune` — Delete sessions older than N days

```bash
vibe prune -d 30                   # delete sessions untouched for 30+ days
vibe prune -d 30 --agent copilot   # only prune Copilot sessions
vibe prune -d 30 --dry-run         # preview: show what would be deleted, no action
vibe prune -d 7 --agent codex      # delete Codex sessions older than 7 days
```

#### `vibe stats` — Disk usage summary

```bash
vibe stats
```

Shows per-agent breakdown: session count, total size, oldest session, newest session, and grand total.

### Supported Agents

| Agent | Storage Location | Scan Method |
|-------|-----------------|-------------|
| **Claude Code** | `~/.claude/projects/<encoded>/*.jsonl` | Direct file scan |
| **Codex (OpenAI)** | `~/.codex/session_index.jsonl` + SQLite DBs + sessions/ | Index parsing + SQLite + file scan |
| **Cursor** | `<appData>/Cursor/User/workspaceStorage/<hash>/chatSessions/` | Workspace storage scan |
| **GitHub Copilot** | `<appData>/Code/User/workspaceStorage/<hash>/` + `GitHub.copilot-chat/transcripts/` | Workspace + Copilot transcript scan |
| **Windsurf** | `<appData>/Windsurf/User/workspaceStorage/<hash>/chatSessions/` | Workspace storage scan |

Scanners gracefully return no results when an agent is not installed on the machine — no errors, just zero sessions.

#### Agent-Specific Notes

**Claude Code** — Each project has encoded directory names (e.g., `D--Code-my-project`) under `~/.claude/projects/`. Within each project directory, individual `.jsonl` files represent conversation sessions. Deleting a session removes the `.jsonl` file and its associated subdirectory.

**Codex (OpenAI)** — Sessions are indexed in `~/.codex/session_index.jsonl` (JSONL format with `id`, `thread_name`, `updated_at`). Actual conversation data lives in shared SQLite databases (`logs_2.sqlite`, `state_5.sqlite`) and per-session rollout files under `~/.codex/sessions/`. The scanner estimates per-session size by dividing total database size by session count. Deleting a session removes its index entry, its SQLite thread and log records, and its rollout file.

**Cursor / Windsurf** — Both are VS Code forks and share the same `workspaceStorage` structure. Each workspace folder is identified by a hash and contains a `workspace.json` that maps to the project path. Sessions live in `chatSessions/` as `.jsonl` or `.json` files. Deleting removes only the session file, preserving workspace configuration.

**GitHub Copilot** — Extends the VS Code workspace storage pattern with additional `GitHub.copilot-chat/transcripts/` directories. The scanner deduplicates entries that appear in both locations.

### Project Structure

```
src/
├── index.ts                    # CLI entry point (commander)
├── types.ts                    # Shared TypeScript interfaces and types
├── utils/
│   ├── platform.ts             # Cross-platform detection (Windows/macOS/Linux)
│   └── formatters.ts           # Time formatting, byte formatting, path decoding
├── scanners/
│   ├── base-scanner.ts         # Abstract scanner with shared I/O utilities
│   ├── claude-code-scanner.ts  # Claude Code session discovery and deletion
│   ├── codex-scanner.ts        # Codex (OpenAI) session discovery and deletion
│   ├── cursor-scanner.ts       # Cursor session discovery and deletion
│   ├── copilot-scanner.ts      # GitHub Copilot session discovery and deletion
│   ├── windsurf-scanner.ts     # Windsurf session discovery and deletion
│   └── registry.ts             # Scanner registry — orchestrates all agent scanners
└── ui/
    ├── display.ts              # Terminal output: tables, colors, stats formatting
    └── interactive.ts          # Interactive deletion UI: checkboxes, confirmations
```

### Architecture

Each agent has its own **scanner** implementing the `IScanner` interface:

```typescript
interface IScanner {
  readonly agent: AgentType;
  getDisplayName(): string;        // human-readable name
  discover(): Promise<Session[]>;  // find all sessions for this agent
  delete(session: Session): Promise<boolean>;  // remove a specific session
}
```

The **ScannerRegistry** aggregates all scanners. CLI commands call the registry, which delegates to the appropriate scanner(s). Adding support for a new agent requires only a new scanner class and a one-line registration.

### Development

```bash
npm run dev     # run with tsx (no compile step needed)
npm run build   # compile TypeScript to dist/
npm run check   # type-check only (no emit)
```
