# VibeCoding Session Manager

A terminal tool to manage AI coding agent sessions and skills — list, delete sessions and manage cross-agent skills for **Claude Code**, **Codex (OpenAI)**, **GitHub Copilot**, **Reasonix**, **OpenCode**, and **Gemini CLI**.

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

### Shell Completion

Tab completion for commands, agents, options, skill names, and session IDs.

Generate the completion script for your shell:

```bash
vibe completion bash        # Bash
vibe completion zsh         # Zsh
vibe completion fish        # Fish
vibe completion powershell  # PowerShell
```

Or auto-detect and install in one step:

```bash
vibe completion install
```

#### Manual Installation

```bash
# Bash
vibe completion bash > ~/.local/share/bash-completion/completions/vibe
source ~/.local/share/bash-completion/completions/vibe

# Zsh
vibe completion zsh > ~/.zfunc/_vibe
# Ensure ~/.zfunc is in your fpath (add to ~/.zshrc):
#   fpath=(~/.zfunc $fpath)

# Fish
vibe completion fish > ~/.config/fish/completions/vibe.fish

# PowerShell
vibe completion powershell >> $PROFILE
```

Restart your shell or source the file to activate.

#### What Gets Completed

Completion is **prefix-based** — only shows results matching what you've already typed.

| Input | Tab Result |
|-------|-----------|
| `vibe l` | `list` |
| `vibe d` | `delete`, `delete-id`, `doctor` |
| `vibe list --` | `--agent`, `--json`, `--help` |
| `vibe list -a c` | `claude`, `copilot`, `codex` |
| `vibe list -a g` | `gemini` |
| `vibe list -a o` | `opencode` |
| `vibe list -a r` | `reasonix` |
| `vibe skills r` | `register` |
| `vibe inspect bd` | `bd378032-fef2-...` (session ID) |
| `vibe completion b` | `bash` |

Completed items include:

- **Command names** — top-level and subcommands (e.g., `skills register`)
- **Agent names** — `claude`, `copilot`, `codex`, `reasonix`, `opencode`, `gemini` for `-a`/`-t`/`-f` flags and positional args
- **Skill names** — dynamically discovered from your skill directories
- **Session IDs** — prefix-matched from your actual sessions (cached for 30s)
- **Flags** — command-specific options (`--json`, `--all`, `--dry-run`, etc.)

### Agent Names

In all commands, agents are referenced by short names:

| Name | Agent |
|------|-------|
| `claude` | Claude Code |
| `codex` | Codex (OpenAI) |
| `copilot` | GitHub Copilot |
| `reasonix` | Reasonix |
| `opencode` | OpenCode |
| `gemini` | Gemini CLI |

Run `vibe --help` to see this list at any time.

### Session Commands

#### `vibe list` — List all sessions grouped by agent

```bash
vibe list                    # show all agents
vibe list --agent claude     # filter by specific agent
vibe list --agent codex      # only Codex sessions
vibe list --agent opencode   # only OpenCode sessions
vibe list --agent gemini     # only Gemini CLI sessions
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
vibe delete --all                  # delete ALL sessions from ALL agents (with confirmation)
```

#### `vibe delete-id` — Delete a specific session by its ID

```bash
vibe delete-id <session-id> -a claude
```

#### `vibe prune` — Delete sessions older than N days

```bash
vibe prune -d 30                   # delete sessions untouched for 30+ days
vibe prune -d 30 --agent copilot   # only prune Copilot sessions
vibe prune -d 30 --dry-run         # preview: show what would be deleted, no action
```

#### `vibe stats` — Web dashboard for session statistics

```bash
vibe stats                # launch dashboard (random port)
vibe stats --port 3000    # specify port
```

Launches a local web server and opens a browser dashboard showing:

- **Overview cards** — per-agent session count and storage size
- **Account info** — plan type, subscription period (detected from local auth files)
- **Quota tracking** — for Codex (ChatGPT Plus), shows real-time remaining quota for 5-hour and 1-week windows as progress bars (fetched from `chatgpt.com/backend-api/codex/usage`)
- **Token usage** — click an agent card to load token breakdown (input, cache hit, cache create, output) for each session, with sortable columns
- **Session detail** — click a session row to view full detail (messages, token usage, preview)

The dashboard uses a dark theme with agent brand colors (Claude Code orange, Copilot cyan, Codex green, Reasonix purple, OpenCode orange, Gemini blue) and supports responsive layout.

Quota data is cached for 30 seconds to avoid excessive API calls on repeated refreshes. If an API call fails after the cache expires, the last successful data is preserved and displayed until the next successful fetch. Press `Ctrl+C` in the terminal to stop the server.

#### `vibe inspect` — Show detailed session information

```bash
vibe inspect <session-id> -a claude   # Claude Code: full JSONL parse with preview
vibe inspect <session-id> -a codex    # Codex: rollout + SQLite metadata
vibe inspect <session-id> -a copilot  # Copilot: transcript summary and file paths
vibe inspect <session-id> -a reasonix # Reasonix: events JSONL summary
vibe inspect <session-id> -a opencode # OpenCode: SQLite/JSON storage summary
vibe inspect <session-id> -a gemini   # Gemini CLI: JSON chat/checkpoint summary
```

Displays project name, session ID, path, last activity, size, first/last user message, message count, token usage (input/output/cached/total), preview, and raw file list.

**Token usage** is displayed when the agent provides usage data:

- **Claude Code** — extracted from `message.usage` in assistant entries of the JSONL session file. Consecutive entries with identical `(input_tokens, output_tokens, cache_read_input_tokens)` values are deduplicated — each group represents a single API call, while subsequent entries are streaming chunks or tool-call iterations that share the same usage data.

  **Fields displayed (all agents, unified format):**
  - `Input` — input tokens (not served from cache)
  - `Cache Hit` — tokens served from prompt cache (`cache_read_input_tokens`)
  - `Cache Create` — tokens used to create prompt cache (`cache_creation_input_tokens`)
  - `Output` — output tokens
  - `Total` — sum of all above

  Fields unavailable from an agent's data source are displayed as "-".

  **Note:** Session files are project-scoped rolling logs, accumulating data across multiple CLI sessions. Token totals reflect all conversations within the file, not just the most recent one.

- **Codex** — input and output tokens extracted from `token_count` events in rollout JSONL files (cumulative values, last event used). Cache hit/create not available from Codex data source, displayed as "-". Falls back to `tokens_used` in `state_5.sqlite` (plain total number) when rollout data is unavailable.

- **Copilot** — output tokens extracted from `completionTokens` field in VS Code chatSessions JSONL. Input, cache hit, and cache create are not available from Copilot's data source, displayed as "-". Only chatSessions format contains token data; transcript format does not.

- **Reasonix** — best-effort extraction from `usage`, `tokenUsage`, `tokens`, or `cost` objects in Reasonix events JSONL. Supports common prompt/completion/cache token field names.

- **OpenCode** — extracted from `tokens_input`, `tokens_output`, `tokens_cache_read`, and `tokens_cache_write` columns in OpenCode SQLite session rows when available. JSON storage fallback uses best-effort token field extraction.

- **Gemini CLI** — best-effort extraction from `usage`, `tokenUsage`, `token_usage`, or `metadata` objects in Gemini JSON chat/checkpoint files. Supports common prompt/completion/total token field names.

#### `vibe search` — Full-text search across session content

```bash
vibe search "docker compose"              # search all agents
vibe search "RAG" --agent claude          # only Claude Code
vibe search "PostgreSQL" --agent codex    # only Codex
vibe search "refactor" --agent opencode   # only OpenCode
vibe search "tests" --agent gemini        # only Gemini CLI
vibe search "API" --since 30              # only last 30 days
vibe search "error" --limit 5             # limit to 5 sessions
```

Searches user messages across agent session files with plain text matching (multi-keyword AND). Shows matched session with highlighted snippet. `--agent`, `--since`, `--limit` filters supported.

#### `vibe doctor` — Health check across all agents

```bash
vibe doctor
```

Checks each agent's session paths, skill directories, file permissions, and detects anomalies: empty session files, invalid JSONL lines, orphan rollout files with no matching SQLite thread, corrupt indices. Outputs a per-agent status summary with issues flagged.

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
vibe skills register karpathy-guidelines --to copilot --from claude # explicit source
```

#### `vibe skills deregister` — Remove a skill from an agent

Deletes the skill directory from the specified agent.

```bash
vibe skills deregister karpathy-guidelines --from claude
```

#### `vibe skills inspect` — Show detailed skill information

```bash
vibe skills inspect karpathy-guidelines
```

Displays skill name, description, which agents have it registered with full paths, and a file listing per agent.

#### `vibe skills diff` — Compare a skill between two agents

```bash
vibe skills diff karpathy-guidelines claude codex
```

Checks whether `SKILL.md` content differs and whether any files exist in only one agent. Reports differences clearly.

### Supported Agents

| Agent | Sessions | Skills |
|-------|----------|--------|
| **Claude Code** | `~/.claude/projects/<encoded>/*.jsonl` | `~/.claude/skills/` |
| **Codex (OpenAI)** | `~/.codex/session_index.jsonl` + SQLite DBs | `~/.codex/skills/` (system skills in `.system/`) |
| **GitHub Copilot** | `<appData>/Code/User/workspaceStorage/<hash>/` + transcripts | `~/.copilot/skills/` |
| **Reasonix** | `~/.reasonix/session-state/`, `~/.reasonix/sessions/`, project `.reasonix/` JSONL events | `~/.reasonix/skills/` |
| **OpenCode** | `~/.local/share/opencode/opencode.db`, `opencode-*.db`, and `project/*/storage/session/` JSON files | `~/.config/opencode/skills/` |
| **Gemini CLI** | `~/.gemini/tmp/<project_hash>/chats/*.json` and saved/checkpoint JSON files | `~/.gemini/skills/` |

Scanners gracefully return no results when an agent is not installed on the machine — no errors, just zero sessions.

#### Agent-Specific Notes

**Claude Code** — Sessions: each project has encoded directory names (e.g., `D--Code-my-project`) under `~/.claude/projects/`. Deleting a session removes the `.jsonl` file and its associated subdirectory. Skills: `~/.claude/skills/<name>/SKILL.md`.

**Codex (OpenAI)** — Sessions indexed in `~/.codex/session_index.jsonl`. Actual data in shared SQLite databases (`logs_2.sqlite`, `state_5.sqlite`) and per-session rollout files under `~/.codex/sessions/`. Deleting removes index entry, SQLite records, and rollout files. Skills: `~/.codex/skills/<name>/SKILL.md`, with built-in skills under `.system/` subdirectory.

**GitHub Copilot** — Sessions stored in VS Code workspace storage under `chatSessions/` and `GitHub.copilot-chat/transcripts/` directories. Duplicate sessions across these directories are automatically deduplicated by filename. Skills: `~/.copilot/skills/<name>/SKILL.md`. Note: Copilot may also discover skills from other agents' directories at runtime.

**Reasonix** — Sessions are discovered from global `~/.reasonix/session-state/`, `~/.reasonix/sessions/`, `~/.reasonix/transcripts/`, and configured/current project `.reasonix/` JSONL files. Deleting an `events.jsonl` session removes its containing session directory; deleting a standalone JSONL session removes that file. Skills: `~/.reasonix/skills/<name>/SKILL.md`; existing flat `~/.reasonix/skills/<name>.md` files are also discovered.

**OpenCode** — Sessions are discovered from the default data directory `~/.local/share/opencode/`, or `OPENCODE_DATA_DIR` when set. SQLite sessions are read from `opencode.db` and channel-specific `opencode-*.db` files; legacy/project JSON storage under `project/*/storage/session/` is also discovered. Deleting a SQLite session removes session/message/part/todo rows for that session; deleting a JSON session removes the session file. Skills: `~/.config/opencode/skills/<name>/SKILL.md`.

**Gemini CLI** — Sessions are discovered from project-scoped JSON files under `~/.gemini/tmp/<project_hash>/chats/` plus saved/checkpoint JSON files in the same temp tree. Deleting a Gemini session removes the JSON session/checkpoint file. Skills: `~/.gemini/skills/<name>/SKILL.md`.

### Project Structure

```
src/
├── index.ts                    # CLI entry point (commander)
├── types.ts                    # Shared TypeScript interfaces and types
├── completion.ts               # Shell completion scripts and handler
├── utils/
│   ├── platform.ts             # Cross-platform detection (Windows/macOS/Linux)
│   └── formatters.ts           # Time formatting, byte formatting, path decoding
├── scanners/
│   ├── base-scanner.ts         # Abstract scanner with shared I/O utilities
│   ├── claude-code-scanner.ts  # Claude Code session discovery and deletion
│   ├── codex-scanner.ts        # Codex (OpenAI) session discovery and deletion
│   ├── copilot-scanner.ts      # GitHub Copilot session discovery and deletion
│   ├── reasonix-scanner.ts     # Reasonix session discovery and deletion
│   ├── opencode-scanner.ts     # OpenCode session discovery and deletion
│   ├── gemini-scanner.ts       # Gemini CLI session discovery and deletion
│   └── registry.ts             # Scanner registry — orchestrates all agent scanners
├── skills/
│   ├── skill-registry.ts       # Skill discovery, registration, deregistration, inspect, diff
│   └── display.ts              # Skill overview table, inspect, diff, JSON output
├── search/
│   ├── search.ts               # Full-text search across agent session content
│   └── display.ts              # Search result display with term highlighting
├── doctor/
│   ├── doctor.ts               # Health check: path existence, permissions, orphan detection
│   └── display.ts              # Health check result display
├── ui/
│   ├── display.ts              # Terminal output: tables, colors, stats formatting
│   ├── inspect.ts              # Session detail inspection display
│   └── interactive.ts          # Interactive deletion UI: checkboxes, confirmations
└── web/
    ├── server.ts               # HTTP server, API routes, browser launch
    ├── html.ts                 # Dashboard HTML/CSS/JS (inline template string)
    └── quota.ts                # Account detection and quota fetching (Claude Code, Codex)
```

### Architecture

**Sessions** — Each agent has a **scanner** implementing the `IScanner` interface:

```typescript
interface IScanner {
  readonly agent: AgentType;
  getDisplayName(): string;
  discover(): Promise<Session[]>;
  delete(session: Session): Promise<boolean>;
  inspect?(session: Session): Promise<SessionDetail>;
}
```

The **ScannerRegistry** aggregates all scanners. CLI commands call the registry, which delegates to the appropriate scanner(s).

**Skills** — The **SkillRegistry** scans each agent's skill directory, groups skills by name across agents, and provides register/deregister operations via directory copy/delete. Built-in skill detection is agent-specific (e.g., Codex uses a `.system/` subdirectory marker).

### Development

```bash
npm run dev     # run with tsx (no compile step needed)
npm run build   # compile TypeScript to dist/
npm run check   # type-check only (no emit)
npm test        # run Node test suite through tsx
```
