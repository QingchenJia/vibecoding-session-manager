# VibeCoding Session Manager / VibeCoding 会话管理器

[English](#english) | [中文](#中文)

---

## English

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
| **Codex (OpenAI)** | `~/.codex/session_index.jsonl` + SQLite DBs | Index parsing, size estimated from shared DBs |
| **Cursor** | `<appData>/Cursor/User/workspaceStorage/<hash>/chatSessions/` | Workspace storage scan |
| **GitHub Copilot** | `<appData>/Code/User/workspaceStorage/<hash>/` + `GitHub.copilot-chat/transcripts/` | Workspace + Copilot transcript scan |
| **Windsurf** | `<appData>/Windsurf/User/workspaceStorage/<hash>/chatSessions/` | Workspace storage scan |

Scanners gracefully return no results when an agent is not installed on the machine — no errors, just zero sessions.

#### Agent-Specific Notes

**Claude Code** — Each project has encoded directory names (e.g., `D--Code-my-project`) under `~/.claude/projects/`. Within each project directory, individual `.jsonl` files represent conversation sessions. Deleting a session removes the `.jsonl` file and its associated subdirectory.

**Codex (OpenAI)** — Sessions are indexed in `~/.codex/session_index.jsonl` (JSONL format with `id`, `thread_name`, `updated_at`). Actual conversation data lives in shared SQLite databases (`logs_2.sqlite`, `state_5.sqlite`). The scanner estimates per-session size by dividing total database size by session count. Deleting a session removes its entry from the index file; conversation data in the SQLite databases may persist and should be cleaned via Codex CLI if deeper cleanup is needed.

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

---

## 中文

一个用于管理 AI 编程 Agent 会话的终端工具 —— 对 **Claude Code**、**Codex (OpenAI)**、**Cursor**、**GitHub Copilot** 和 **Windsurf** 的对话会话进行浏览、查看和删除。

### 动机

AI 编程 Agent 会随时间在磁盘上积累大量的会话文件 —— 对话记录、上下文数据、日志等。这些文件可能增长到数百兆字节，且永远不会被自动清理。本工具提供一个统一的界面，助你跨所有 Agent 浏览、评估和清理这些数据。

### 安装

```bash
git clone https://github.com/QingchenJia/vibecoding-session-manager.git
cd vibecoding-session-manager
npm install -g .
```

`npm install -g .` 从当前目录将包安装到全局。安装过程会自动：
1. 执行 `tsc`（通过 `prepare` 脚本）编译 TypeScript
2. 在 npm 全局 bin 目录下创建 `vibe` / `vibe.cmd` 包装器（该目录已在系统 `PATH` 中）
3. 无需手动配置任何环境变量

安装完成后，`vibe` 命令可在任意终端、任意目录下直接使用。

**环境要求：** Node.js >= 18

### 命令详解

#### `vibe list` — 按 Agent 分组列出所有会话

```bash
vibe list                        # 显示所有 Agent 的会话
vibe list --agent claude-code    # 仅显示指定 Agent
vibe list --agent codex          # 仅显示 Codex 会话
vibe list --json                 # JSON 格式输出，适合脚本处理
```

输出以分组形式展示，每个会话显示：ID（前 8 位）、项目名称、最后活跃时间和文件大小。不同 Agent 以不同颜色区分。

#### `vibe delete` — 交互式删除会话（核心功能）

两步交互流程：
1. **选择 Agent** — 从列表中选一个（或选"全部"）
2. **多选会话** — 复选框列表，空格切换选中、输入关键字过滤、回车确认
3. **确认** — 显示即将删除的会话数量和释放的磁盘空间
4. **执行** — 逐条删除并显示进度

```bash
vibe delete                        # 跨所有 Agent 交互式选择删除
vibe delete --agent copilot        # 先筛选 Copilot，再交互选择
vibe delete --all --agent codex    # 一键删除全部 Codex 会话（需确认）
vibe delete --all --agent copilot  # 一键删除全部 Copilot 会话
vibe delete --all                  # 删除全部 Agent 的全部会话（双重确认）
```

#### `vibe delete-id` — 按 ID 精确删除

适用于脚本调用，或已知会话 ID 时快速删除：

```bash
vibe delete-id b68c4922-9707-4fb6-bd60-5e4a56087c58 -a claude-code
```

#### `vibe prune` — 按时间清理旧会话

```bash
vibe prune -d 30                   # 删除 30 天未活动的会话
vibe prune -d 30 --agent copilot   # 仅清理 Copilot 的旧会话
vibe prune -d 30 --dry-run         # 预览模式：仅显示将删除的内容，不实际执行
vibe prune -d 7 --agent codex      # 删除 Codex 7 天前的会话
```

#### `vibe stats` — 磁盘使用统计

```bash
vibe stats
```

按 Agent 展示：会话数量、占用空间、最老会话、最新会话以及总计。

### 支持的 Agent

| Agent | 存储位置 | 扫描方式 |
|-------|---------|---------|
| **Claude Code** | `~/.claude/projects/<编码名>/*.jsonl` | 直接文件扫描 |
| **Codex (OpenAI)** | `~/.codex/session_index.jsonl` + SQLite 数据库 | 索引解析，按数据库总量均分估算大小 |
| **Cursor** | `<appData>/Cursor/User/workspaceStorage/<hash>/chatSessions/` | 工作区存储扫描 |
| **GitHub Copilot** | `<appData>/Code/User/workspaceStorage/<hash>/` + `GitHub.copilot-chat/transcripts/` | 工作区 + Copilot 记录双重扫描 |
| **Windsurf** | `<appData>/Windsurf/User/workspaceStorage/<hash>/chatSessions/` | 工作区存储扫描 |

若某 Agent 未在本机安装，对应扫描器会静默返回零条记录 —— 不会报错。

#### 各 Agent 扫描说明

**Claude Code** — 每个项目在 `~/.claude/projects/` 下有一个编码后的目录名（如 `D--Code-my-project`）。每个项目目录内，各 `.jsonl` 文件对应一个对话会话。删除会话时会同时移除 `.jsonl` 文件及其关联子目录。

**Codex (OpenAI)** — 会话索引存储在 `~/.codex/session_index.jsonl`（JSONL 格式，含 `id`、`thread_name`、`updated_at` 字段）。实际对话数据存储在共享的 SQLite 数据库中（`logs_2.sqlite`、`state_5.sqlite`）。扫描器按数据库总大小与会话数量均分来估算每个会话的大小。删除会话时仅从索引文件中移除对应条目；SQLite 库中的对话数据可能仍存在，如需深度清理请使用 Codex CLI 内置命令。

**Cursor / Windsurf** — 两者均为 VS Code 分支，共享相同的 `workspaceStorage` 目录结构。每个工作区以 hash 命名的子目录标识，内含 `workspace.json` 映射到实际项目路径。会话文件位于 `chatSessions/` 下，为 `.jsonl` 或 `.json` 格式。删除仅移除会话文件，不影响工作区配置。

**GitHub Copilot** — 在 VS Code workspaceStorage 基础上，额外增加了 `GitHub.copilot-chat/transcripts/` 目录来存储对话记录。扫描器会对两处来源进行去重。

### 项目结构

```
src/
├── index.ts                    # CLI 入口（commander 命令框架）
├── types.ts                    # 共享 TypeScript 接口与类型定义
├── utils/
│   ├── platform.ts             # 跨平台检测（Windows/macOS/Linux）
│   └── formatters.ts           # 时间、字节、路径格式化
├── scanners/
│   ├── base-scanner.ts         # 抽象基类，提供共享的文件 I/O 工具方法
│   ├── claude-code-scanner.ts  # Claude Code 会话发现与删除
│   ├── codex-scanner.ts        # Codex (OpenAI) 会话发现与删除
│   ├── cursor-scanner.ts       # Cursor 会话发现与删除
│   ├── copilot-scanner.ts      # GitHub Copilot 会话发现与删除
│   ├── windsurf-scanner.ts     # Windsurf 会话发现与删除
│   └── registry.ts             # 扫描器注册表 —— 统一调度各 Agent 扫描器
└── ui/
    ├── display.ts              # 终端输出：表格、颜色、统计格式化
    └── interactive.ts          # 交互式删除 UI：复选框、确认等
```

### 架构设计

每个 Agent 对应一个独立的**扫描器**，实现 `IScanner` 接口：

```typescript
interface IScanner {
  readonly agent: AgentType;
  getDisplayName(): string;        // 用户可读的显示名称
  discover(): Promise<Session[]>;  // 发现该 Agent 的所有会话
  delete(session: Session): Promise<boolean>;  // 删除指定会话
}
```

**ScannerRegistry**（扫描器注册表）汇总所有扫描器。CLI 命令调用注册表，注册表将请求分发到对应的扫描器。新增 Agent 支持只需编写一个新的扫描器类并在注册表中添加一行注册代码即可。

### 开发

```bash
npm run dev     # 使用 tsx 直接运行（无需编译）
npm run build   # 编译 TypeScript 到 dist/
npm run check   # 仅类型检查（不输出文件）
```
