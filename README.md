# VibeCoding Session Manager

**简体中文** | [English](README.en.md)

一款用于管理 AI 编程代理会话与技能的终端工具——可统一列出、删除会话，并在 **Claude Code**、**Codex (OpenAI)**、**GitHub Copilot**、**Reasonix**、**OpenCode** 和 **Gemini CLI** 之间管理技能。

### 为什么需要它

AI 编程代理会不断在磁盘上积累会话文件与技能。会话中包含对话记录、上下文数据和日志，长期使用后可能占用数百 MB 空间，而且通常不会自动清理。技能则分散在不同代理各自的目录中，需要手动复制。此工具为这两类数据提供了统一的管理界面。

### 安装

```bash
git clone https://github.com/QingchenJia/vibecoding-session-manager.git
cd vibecoding-session-manager
npm install -g .
```

`npm install -g .` 会从当前目录全局安装该软件包，并自动完成以下操作：

1. 通过 `prepare` 脚本运行 `tsc`，编译 TypeScript
2. 在 npm 全局可执行文件目录（通常已加入 `PATH`）中创建 `vibe` / `vibe.cmd` 启动脚本
3. 无需手动配置环境变量

安装完成后，可在任意终端、任意目录中使用 `vibe` 命令。

**环境要求：** Node.js >= 18

### Shell 命令补全

支持对命令、代理、选项、技能名称及会话 ID 进行 Tab 补全。

为当前 Shell 生成补全脚本：

```bash
vibe completion bash        # Bash
vibe completion zsh         # Zsh
vibe completion fish        # Fish
vibe completion powershell  # PowerShell
```

也可以自动检测 Shell 并一步完成安装：

```bash
vibe completion install
```

#### 手动安装

```bash
# Bash
vibe completion bash > ~/.local/share/bash-completion/completions/vibe
source ~/.local/share/bash-completion/completions/vibe

# Zsh
vibe completion zsh > ~/.zfunc/_vibe
# 确保 ~/.zfunc 位于 fpath 中（可添加到 ~/.zshrc）：
#   fpath=(~/.zfunc $fpath)

# Fish
vibe completion fish > ~/.config/fish/completions/vibe.fish

# PowerShell
vibe completion powershell >> $PROFILE
```

重启 Shell 或重新加载对应配置文件即可启用补全。

#### 可补全的内容

补全采用**前缀匹配**，只显示与已输入内容匹配的结果。

| 输入 | Tab 补全结果 |
|------|-------------|
| `vibe l` | `list` |
| `vibe d` | `delete`、`delete-id`、`doctor` |
| `vibe list --` | `--agent`、`--json`、`--help` |
| `vibe list -a c` | `claude`、`copilot`、`codex` |
| `vibe list -a g` | `gemini` |
| `vibe list -a o` | `opencode` |
| `vibe list -a r` | `reasonix` |
| `vibe skills r` | `register` |
| `vibe inspect bd` | `bd378032-fef2-...`（会话 ID） |
| `vibe completion b` | `bash` |

补全范围包括：

- **命令名称**——顶层命令和子命令（如 `skills register`）
- **代理名称**——为 `-a` / `-t` / `-f` 参数及位置参数补全 `claude`、`copilot`、`codex`、`reasonix`、`opencode`、`gemini`
- **技能名称**——从本机技能目录动态发现
- **会话 ID**——根据实际会话进行前缀匹配（缓存 30 秒）
- **参数选项**——各命令专属选项，如 `--json`、`--all`、`--dry-run` 等

### 代理名称

所有命令均使用以下短名称引用代理：

| 名称 | 代理 |
|------|------|
| `claude` | Claude Code |
| `codex` | Codex (OpenAI) |
| `copilot` | GitHub Copilot |
| `reasonix` | Reasonix |
| `opencode` | OpenCode |
| `gemini` | Gemini CLI |

随时运行 `vibe --help` 即可查看此列表。

### 会话命令

#### `vibe list`——按代理分组列出全部会话

```bash
vibe list                    # 显示所有代理
vibe list --agent claude     # 按指定代理筛选
vibe list --agent codex      # 仅显示 Codex 会话
vibe list --agent opencode   # 仅显示 OpenCode 会话
vibe list --agent gemini     # 仅显示 Gemini CLI 会话
vibe list --json             # 输出机器可读的 JSON
```

输出会按代理分组并使用不同颜色，显示每个会话的 ID（前 8 个字符）、项目名称、最后活动时间及文件大小。

#### `vibe delete`——交互式删除会话

交互流程：

1. 从列表中**选择代理**（或选择“所有代理”）
2. 使用复选框**多选会话**（空格切换、输入文字筛选、回车确认）
3. **确认操作**——显示待删除数量及预计释放的总空间
4. **执行删除**——逐个显示会话处理进度

```bash
vibe delete                        # 在所有代理中交互式多选
vibe delete --agent copilot        # 先筛选 Copilot，再交互选择
vibe delete --all --agent codex    # 删除全部 Codex 会话（需确认）
vibe delete --all                  # 删除全部代理的全部会话（需确认）
```

#### `vibe delete-id`——按 ID 删除指定会话

```bash
vibe delete-id <session-id> -a claude
```

#### `vibe prune`——删除早于指定天数的会话

```bash
vibe prune -d 30                   # 删除 30 天及更久未活动的会话
vibe prune -d 30 --agent copilot   # 仅清理 Copilot 会话
vibe prune -d 30 --dry-run         # 仅预览，不执行删除
```

#### `vibe stats`——会话统计 Web 仪表盘

```bash
vibe stats                # 使用随机端口启动仪表盘
vibe stats --port 3000    # 指定端口
```

该命令会启动本地 Web 服务器并打开浏览器仪表盘，其中包括：

- **概览卡片**——每个代理的会话数量和存储占用
- **账户信息**——从本地认证文件检测套餐类型与订阅周期
- **配额跟踪**——针对 Codex（ChatGPT Plus）实时显示 5 小时和 1 周窗口的剩余配额进度条（数据来自 `chatgpt.com/backend-api/codex/usage`）
- **Token 用量**——点击代理卡片可加载各会话的输入、缓存命中、缓存创建及输出 Token，并支持表格排序
- **会话详情**——点击会话行可查看消息、Token 用量和预览等完整信息

仪表盘采用深色主题和各代理的品牌色（Claude Code 橙色、Copilot 青色、Codex 绿色、Reasonix 紫色、OpenCode 橙色、Gemini 蓝色），并支持响应式布局。

配额数据会缓存 30 秒，避免重复刷新触发过多 API 请求。缓存过期后若 API 调用失败，将保留并显示最近一次成功获取的数据，直至下次请求成功。在终端中按 `Ctrl+C` 可停止服务器。

#### `vibe inspect`——查看会话详情

```bash
vibe inspect <session-id> -a claude   # Claude Code：完整解析 JSONL 并预览
vibe inspect <session-id> -a codex    # Codex：rollout 与 SQLite 元数据
vibe inspect <session-id> -a copilot  # Copilot：记录摘要及文件路径
vibe inspect <session-id> -a reasonix # Reasonix：events JSONL 摘要
vibe inspect <session-id> -a opencode # OpenCode：SQLite/JSON 存储摘要
vibe inspect <session-id> -a gemini   # Gemini CLI：JSON 对话/检查点摘要
```

该命令显示项目名称、会话 ID、路径、最后活动时间、大小、首条/末条用户消息、消息数量、Token 用量（输入/输出/缓存/总计）、预览及原始文件列表。

代理提供用量数据时，还会显示 **Token 用量**：

- **Claude Code**——从 JSONL 会话文件中 assistant 条目的 `message.usage` 提取。连续条目如果具有相同的 `(input_tokens, output_tokens, cache_read_input_tokens)`，会被去重；每一组代表一次 API 调用，后续重复条目通常是共享相同用量数据的流式分块或工具调用迭代。

  **统一显示字段（适用于所有代理）：**

  - `Input`——未由缓存提供的输入 Token
  - `Cache Hit`——来自提示词缓存的 Token（`cache_read_input_tokens`）
  - `Cache Create`——用于创建提示词缓存的 Token（`cache_creation_input_tokens`）
  - `Output`——输出 Token
  - `Total`——上述所有字段之和

  如果某代理的数据源不提供某个字段，该字段将显示为“-”。

  **注意：** 会话文件是项目级滚动日志，会累积多次 CLI 会话的数据。Token 总数表示该文件中所有对话的总量，而不仅是最近一次对话。

- **Codex**——从 rollout JSONL 文件的 `token_count` 事件提取输入及输出 Token（使用最后一条累计值）。Codex 数据源不提供缓存命中/创建数据，因此显示为“-”。如果 rollout 数据不可用，则回退到 `state_5.sqlite` 中的 `tokens_used`（仅总数）。

- **Copilot**——从 VS Code chatSessions JSONL 的 `completionTokens` 字段提取输出 Token。数据源不提供输入、缓存命中及缓存创建数据，因此显示为“-”。仅 chatSessions 格式包含 Token 数据，transcript 格式不包含。

- **Reasonix**——尽力从 Reasonix events JSONL 中的 `usage`、`tokenUsage`、`tokens` 或 `cost` 对象提取，并兼容常见的提示词、补全和缓存 Token 字段名称。

- **OpenCode**——如果存在对应列，则从 OpenCode SQLite 会话行的 `tokens_input`、`tokens_output`、`tokens_cache_read` 和 `tokens_cache_write` 提取。使用 JSON 存储回退方案时，会尽力匹配 Token 字段。

- **Gemini CLI**——尽力从 Gemini JSON 对话/检查点文件的 `usage`、`tokenUsage`、`token_usage` 或 `metadata` 对象提取，并兼容常见的提示词、补全及总 Token 字段名称。

#### `vibe search`——全文搜索会话内容

```bash
vibe search "docker compose"              # 搜索所有代理
vibe search "RAG" --agent claude          # 仅搜索 Claude Code
vibe search "PostgreSQL" --agent codex    # 仅搜索 Codex
vibe search "refactor" --agent opencode   # 仅搜索 OpenCode
vibe search "tests" --agent gemini        # 仅搜索 Gemini CLI
vibe search "API" --since 30              # 仅搜索最近 30 天
vibe search "error" --limit 5             # 最多显示 5 个会话
```

该命令会以纯文本方式在各代理的会话文件中搜索用户消息（多个关键词采用 AND 匹配），显示匹配会话及高亮摘要，并支持 `--agent`、`--since`、`--limit` 筛选。

#### `vibe doctor`——检查所有代理的健康状态

```bash
vibe doctor
```

检查各代理的会话路径、技能目录和文件权限，并检测空会话文件、无效 JSONL 行、没有对应 SQLite thread 的孤立 rollout 文件及损坏索引等异常。输出按代理汇总，并标记发现的问题。

### 技能命令

技能是安装在代理专属目录中的个人扩展。在某一代理中安装的技能不会自动出现在其他代理中。`vibe skills` 提供统一视图及跨代理注册功能。

#### `vibe skills`——查看全部个人技能

```bash
vibe skills           # 以表格显示各技能在每个代理中的注册状态
vibe skills --json    # 输出机器可读的 JSON
```

代理的内置技能（如 Codex 系统技能）会被排除，只显示用户安装的个人技能。

#### `vibe skills register`——将技能注册到另一个代理

从已经安装该技能的任意代理，将其复制到目标代理的技能目录。

```bash
vibe skills register karpathy-guidelines --to copilot               # 自动发现来源
vibe skills register karpathy-guidelines --to copilot --from claude # 明确指定来源
```

#### `vibe skills deregister`——从代理中移除技能

删除指定代理中的技能目录。

```bash
vibe skills deregister karpathy-guidelines --from claude
```

#### `vibe skills inspect`——查看技能详情

```bash
vibe skills inspect karpathy-guidelines
```

显示技能名称、描述、已注册该技能的代理及完整路径，以及每个代理中的文件列表。

#### `vibe skills diff`——比较两个代理中的技能

```bash
vibe skills diff karpathy-guidelines claude codex
```

检查两边的 `SKILL.md` 内容是否不同，以及是否存在仅出现在其中一边的文件，并清晰展示差异。

### 支持的代理

| 代理 | 会话 | 技能 |
|------|------|------|
| **Claude Code** | `~/.claude/projects/<encoded>/*.jsonl` | `~/.claude/skills/` |
| **Codex (OpenAI)** | `~/.codex/session_index.jsonl` + SQLite 数据库 | `~/.codex/skills/`（系统技能位于 `.system/`） |
| **GitHub Copilot** | `<appData>/Code/User/workspaceStorage/<hash>/` + transcripts | `~/.copilot/skills/` |
| **Reasonix** | `~/.reasonix/session-state/`、`~/.reasonix/sessions/`、项目内 `.reasonix/` JSONL events | `~/.reasonix/skills/` |
| **OpenCode** | `~/.local/share/opencode/opencode.db`、`opencode-*.db` 及 `project/*/storage/session/` JSON 文件 | `~/.config/opencode/skills/` |
| **Gemini CLI** | `~/.gemini/tmp/<project_hash>/chats/*.json` 及保存的/检查点 JSON 文件 | `~/.gemini/skills/` |

如果机器上未安装某个代理，其扫描器会直接返回空结果，不会报错。

#### 各代理说明

**Claude Code**——会话：每个项目在 `~/.claude/projects/` 下对应一个编码后的目录名（如 `D--Code-my-project`）。删除会话时会移除 `.jsonl` 文件及其关联子目录。技能：`~/.claude/skills/<name>/SKILL.md`。

**Codex (OpenAI)**——会话索引位于 `~/.codex/session_index.jsonl`。实际数据存储在共享 SQLite 数据库（`logs_2.sqlite`、`state_5.sqlite`）以及 `~/.codex/sessions/` 下每个会话的 rollout 文件中。删除时会同时移除索引条目、SQLite 记录和 rollout 文件。技能：`~/.codex/skills/<name>/SKILL.md`，内置技能位于 `.system/` 子目录。

**GitHub Copilot**——会话存储在 VS Code workspace storage 下的 `chatSessions/` 和 `GitHub.copilot-chat/transcripts/` 目录中。这些目录里文件名相同的重复会话会自动去重。技能：`~/.copilot/skills/<name>/SKILL.md`。注意：Copilot 在运行时也可能发现其他代理目录中的技能。

**Reasonix**——从全局 `~/.reasonix/session-state/`、`~/.reasonix/sessions/`、`~/.reasonix/transcripts/`，以及已配置项目/当前项目的 `.reasonix/` JSONL 文件中发现会话。删除 `events.jsonl` 会话时会移除其所在的会话目录；删除独立 JSONL 会话时则只移除该文件。技能：`~/.reasonix/skills/<name>/SKILL.md`；也能发现已有的扁平文件 `~/.reasonix/skills/<name>.md`。

**OpenCode**——从默认数据目录 `~/.local/share/opencode/`（设置 `OPENCODE_DATA_DIR` 时使用该目录）发现会话。SQLite 会话来自 `opencode.db` 和各通道的 `opencode-*.db` 文件，也会发现 `project/*/storage/session/` 下的旧版/项目 JSON 存储。删除 SQLite 会话时，会移除该会话对应的 session、message、part 和 todo 行；删除 JSON 会话时则移除会话文件。技能：`~/.config/opencode/skills/<name>/SKILL.md`。

**Gemini CLI**——从 `~/.gemini/tmp/<project_hash>/chats/` 下按项目存储的 JSON 文件，以及同一临时目录树中的已保存/检查点 JSON 文件发现会话。删除 Gemini 会话时会移除相应的 JSON 会话/检查点文件。技能：`~/.gemini/skills/<name>/SKILL.md`。

### 项目结构

```text
src/
├── index.ts                    # CLI 入口（commander）
├── types.ts                    # 共享 TypeScript 接口及类型
├── completion.ts               # Shell 补全脚本及处理程序
├── utils/
│   ├── platform.ts             # 跨平台检测（Windows/macOS/Linux）
│   └── formatters.ts           # 时间、字节及路径解码格式化
├── scanners/
│   ├── base-scanner.ts         # 提供共享 I/O 工具的抽象扫描器
│   ├── claude-code-scanner.ts  # Claude Code 会话发现与删除
│   ├── codex-scanner.ts        # Codex (OpenAI) 会话发现与删除
│   ├── copilot-scanner.ts      # GitHub Copilot 会话发现与删除
│   ├── reasonix-scanner.ts     # Reasonix 会话发现与删除
│   ├── opencode-scanner.ts     # OpenCode 会话发现与删除
│   ├── gemini-scanner.ts       # Gemini CLI 会话发现与删除
│   └── registry.ts             # 调度所有代理扫描器的注册表
├── skills/
│   ├── skill-registry.ts       # 技能发现、注册、注销、详情及比较
│   └── display.ts              # 技能概览、详情、比较及 JSON 输出
├── search/
│   ├── search.ts               # 跨代理会话内容全文搜索
│   └── display.ts              # 带关键词高亮的搜索结果展示
├── doctor/
│   ├── doctor.ts               # 路径、权限及孤立数据等健康检查
│   └── display.ts              # 健康检查结果展示
├── ui/
│   ├── display.ts              # 终端表格、颜色和统计格式化
│   ├── inspect.ts              # 会话详情展示
│   └── interactive.ts          # 复选框及确认等交互式删除界面
└── web/
    ├── server.ts               # HTTP 服务器、API 路由及浏览器启动
    ├── html.ts                 # 仪表盘 HTML/CSS/JS（内联模板字符串）
    └── quota.ts                # 账户检测及配额获取（Claude Code、Codex）
```

### 架构

**会话**——每个代理都有一个实现 `IScanner` 接口的**扫描器**：

```typescript
interface IScanner {
  readonly agent: AgentType;
  getDisplayName(): string;
  discover(): Promise<Session[]>;
  delete(session: Session): Promise<boolean>;
  inspect?(session: Session): Promise<SessionDetail>;
}
```

`ScannerRegistry` 聚合所有扫描器。CLI 命令调用注册表，再由注册表将操作委托给对应的一个或多个扫描器。

**技能**——`SkillRegistry` 扫描各代理的技能目录，按名称对跨代理技能进行分组，并通过目录复制/删除实现注册与注销。内置技能的识别方式因代理而异（例如 Codex 使用 `.system/` 子目录标记）。

### 开发

```bash
npm run dev     # 使用 tsx 运行，无需预先编译
npm run build   # 将 TypeScript 编译到 dist/
npm run check   # 仅做类型检查，不生成文件
npm test        # 通过 tsx 运行 Node 测试套件
```
