# VibeCoding Session Manager

A terminal tool to manage AI coding agent sessions and skills — list, delete sessions and manage cross-agent skills for **Claude Code**, **Codex (OpenAI)**, and **GitHub Copilot**.

### Motivation

AI coding agents accumulate session files and skills on disk over time. Sessions — conversation transcripts, context data, and logs — can grow to hundreds of megabytes and are never cleaned up automatically. Skills are stored in agent-specific directories and must be manually copied between agents. This tool gives you a unified interface to manage both.

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

### Agent Names

In all commands, agents are referenced by short names:

| Name | Agent |
|------|-------|
| `cc` | Claude Code |
| `codex` | Codex (OpenAI) |
| `copilot` | GitHub Copilot |

Run `vibe --help` to see this list at any time.

### Session Commands

#### `vibe list` — List all sessions grouped by agent

```bash
vibe list                    # show all agents
vibe list --agent cc         # filter by specific agent
vibe list --agent codex      # only Codex sessions
vibe list --json             # machine-readable JSON output
```

Output shows session ID (first 8 chars), project name, last activity time, and file size per session, grouped and color-coded by agent.

#### `vibe delete` — Interactive session deletion

Two-stage interactive flow:
1. **Choose an agent** from the list (or "All agents")
2. **Multi-select sessions** with checkboxes (space to toggle, type to filter, enter to confirm)
3. **Confirm** — shows count and total size to be freed
4. **Execute** with per-session progress feedback

```bash
vibe delete                        # interactive multi-select across all agents
vibe delete --agent copilot        # filter to Copilot first, then interactive
vibe delete --all --agent codex    # delete ALL Codex sessions at once (with confirmation)
vibe delete --all                  # delete ALL sessions from ALL agents (double-confirms)
```

#### `vibe delete-id` — Delete a specific session by its ID

```bash
vibe delete-id <session-id> -a cc
```

#### `vibe prune` — Delete sessions older than N days

```bash
vibe prune -d 30                   # delete sessions untouched for 30+ days
vibe prune -d 30 --agent copilot   # only prune Copilot sessions
vibe prune -d 30 --dry-run         # preview: show what would be deleted, no action
```

#### `vibe stats` — Disk usage summary

```bash
vibe stats
```

Shows per-agent breakdown: session count, total size, oldest session, newest session, and grand total.

### Skill Commands

Skills are personal extensions installed in agent-specific directories. Different agents store skills in different locations, and a skill installed for one agent is not automatically available to others. `vibe skills` provides a unified view and cross-agent registration.

#### `vibe skills` — Overview of all personal skills

```bash
vibe skills           # table showing each skill with per-agent registration status
vibe skills --json    # machine-readable JSON output
```

Agent built-in skills (e.g., Codex system skills) are excluded. Only user-installed personal skills are shown.

#### `vibe skills register` — Register a skill to another agent

Copies a skill from any agent that has it to a target agent's skill directory.

```bash
vibe skills register karpathy-guidelines --to copilot           # auto-discovers source
vibe skills register karpathy-guidelines --to copilot --from cc # explicit source
```

#### `vibe skills deregister` — Remove a skill from an agent

Deletes the skill directory from the specified agent.

```bash
vibe skills deregister karpathy-guidelines --from cc
```

### Supported Agents

| Agent | Sessions | Skills |
|-------|----------|--------|
| **Claude Code** | `~/.claude/projects/<encoded>/*.jsonl` | `~/.claude/skills/` |
| **Codex (OpenAI)** | `~/.codex/session_index.jsonl` + SQLite DBs | `~/.codex/skills/` (system skills in `.system/`) |
| **GitHub Copilot** | `<appData>/Code/User/workspaceStorage/<hash>/` + transcripts | `~/.copilot/skills/` |

Scanners gracefully return no results when an agent is not installed on the machine — no errors, just zero sessions.

#### Agent-Specific Notes

**Claude Code** — Sessions: each project has encoded directory names (e.g., `D--Code-my-project`) under `~/.claude/projects/`. Deleting a session removes the `.jsonl` file and its associated subdirectory. Skills: `~/.claude/skills/<name>/SKILL.md`.

**Codex (OpenAI)** — Sessions indexed in `~/.codex/session_index.jsonl`. Actual data in shared SQLite databases (`logs_2.sqlite`, `state_5.sqlite`) and per-session rollout files under `~/.codex/sessions/`. Deleting removes index entry, SQLite records, and rollout files. Skills: `~/.codex/skills/<name>/SKILL.md`, with built-in skills under `.system/` subdirectory.

**GitHub Copilot** — Sessions stored in VS Code workspace storage with additional `GitHub.copilot-chat/transcripts/` directories. Skills: `~/.copilot/skills/<name>/SKILL.md`. Note: Copilot may also discover skills from other agents' directories at runtime.

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
│   ├── copilot-scanner.ts      # GitHub Copilot session discovery and deletion
│   └── registry.ts             # Scanner registry — orchestrates all agent scanners
├── skills/
│   ├── skill-registry.ts       # Skill discovery, registration, and deregistration
│   └── display.ts              # Skill overview table and JSON output
└── ui/
    ├── display.ts              # Terminal output: tables, colors, stats formatting
    └── interactive.ts          # Interactive deletion UI: checkboxes, confirmations
```

### Architecture

**Sessions** — Each agent has a **scanner** implementing the `IScanner` interface:

```typescript
interface IScanner {
  readonly agent: AgentType;
  getDisplayName(): string;
  discover(): Promise<Session[]>;
  delete(session: Session): Promise<boolean>;
}
```

The **ScannerRegistry** aggregates all scanners. CLI commands call the registry, which delegates to the appropriate scanner(s).

**Skills** — The **SkillRegistry** scans each agent's skill directory, groups skills by name across agents, and provides register/deregister operations via directory copy/delete. Built-in skill detection is agent-specific (e.g., Codex uses a `.system/` subdirectory marker).

### Development

```bash
npm run dev     # run with tsx (no compile step needed)
npm run build   # compile TypeScript to dist/
npm run check   # type-check only (no emit)
```
