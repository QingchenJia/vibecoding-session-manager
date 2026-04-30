# VibeCoding Session Manager

A terminal tool to manage AI coding agent sessions — list, inspect, and delete conversations from Claude Code, Cursor, GitHub Copilot, and Windsurf.

## Installation

```bash
git clone https://github.com/QingchenJia/vibecoding-session-manager.git
cd vibecoding-session-manager
npm install -g .
```

The `vibe` command is available globally after installation. The `prepare` script auto-compiles TypeScript during install.

## Commands

### `vibe list` — List all sessions grouped by agent

```bash
vibe list                     # all agents
vibe list --agent claude-code # filter by agent
vibe list --json              # machine-readable JSON output
```

### `vibe delete` — Interactive session deletion

The core feature. Two-stage selection: pick an agent first, then multi-select sessions with checkboxes, confirm, and execute.

```bash
vibe delete                       # interactive multi-select
vibe delete --agent copilot       # filter by agent, then interactive
vibe delete --all --agent copilot # delete ALL Copilot sessions at once
vibe delete --all                 # delete ALL sessions across all agents
```

### `vibe delete-id` — Delete a specific session by ID

```bash
vibe delete-id <id> -a claude-code
```

### `vibe prune` — Delete sessions older than N days

```bash
vibe prune -d 30                # delete sessions older than 30 days
vibe prune -d 30 --agent cursor # only Cursor sessions
vibe prune -d 30 --dry-run      # preview without deleting
```

### `vibe stats` — Disk usage summary

```bash
vibe stats   # counts and sizes per agent, oldest/newest timestamps
```

## Supported Agents

| Agent | Storage Location |
|-------|-----------------|
| **Claude Code** | `~/.claude/projects/<encoded>/*.jsonl` |
| **Cursor** | `<appData>/Cursor/User/workspaceStorage/<hash>/chatSessions/` |
| **GitHub Copilot** | `<appData>/Code/User/workspaceStorage/<hash>/` + `GitHub.copilot-chat/transcripts/` |
| **Windsurf** | `<appData>/Windsurf/User/workspaceStorage/<hash>/chatSessions/` |

Scanners gracefully return no results when an agent is not installed.

## Project Structure

```
src/
├── index.ts                    # CLI entry (commander)
├── types.ts                    # Shared types
├── utils/
│   ├── platform.ts             # Cross-platform detection
│   └── formatters.ts           # Time, size, and path formatting
├── scanners/
│   ├── base-scanner.ts         # Abstract scanner with shared utilities
│   ├── claude-code-scanner.ts
│   ├── cursor-scanner.ts
│   ├── copilot-scanner.ts
│   ├── windsurf-scanner.ts
│   └── registry.ts             # Scanner registry
└── ui/
    ├── display.ts              # Terminal output formatting
    └── interactive.ts          # Interactive delete UI
```

## Development

```bash
npm run dev     # run with tsx (no compile needed)
npm run build   # compile TypeScript
npm run check   # type-check only
```
