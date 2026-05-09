# Web Stats Dashboard 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `vibe stats` 从终端输出升级为本地 Web 仪表盘，在浏览器中展示会话统计、token 用量和账号信息。

**Architecture:** 使用 Node.js 内置 `http` 模块创建服务器，HTML/CSS/JS 以模板字符串内联提供。API 分层：基础数据秒级返回，token 用量懒加载。

**Tech Stack:** TypeScript, Node.js `http`, 纯 CSS/JS (无框架依赖)

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/types.ts` | 修改 | 新增 QuotaInfo、DashboardData 类型 |
| `src/web/quota.ts` | 新增 | 读取本地 auth/usage 文件，检测账号信息 |
| `src/web/html.ts` | 新增 | 仪表盘 HTML/CSS/JS 模板字符串 |
| `src/web/server.ts` | 新增 | HTTP 服务器、API 路由、浏览器启动 |
| `src/index.ts` | 修改 | stats 命令改为启动 web 服务 |

---

### Task 1: 新增类型定义

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: 在 types.ts 末尾追加新类型**

在 `src/types.ts` 的 `PlatformInfo` 接口之后追加：

```typescript
export interface QuotaInfo {
  agent: AgentType;
  planType?: string;         // "plus", "pro", "free", "代理模式" 等
  subscriptionStart?: string; // ISO date
  subscriptionEnd?: string;   // ISO date
  totalInputTokens?: number;
  totalOutputTokens?: number;
  dailyActivity?: Array<{
    date: string;
    messageCount: number;
    sessionCount: number;
  }>;
}

export interface AgentStatsData {
  agent: AgentType;
  sessionCount: number;
  totalSize: number;
  oldestSession?: { name: string; lastModified: number };
  newestSession?: { name: string; lastModified: number };
  quota?: QuotaInfo;
}

export interface DashboardData {
  agents: AgentStatsData[];
  totalSessions: number;
  totalSize: number;
}

export interface SessionTokenData {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  tokenUsage?: TokenUsage;
  messageCount?: number;
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误输出

- [ ] **Step 3: 提交**

```bash
git add src/types.ts
git commit -m "feat: add dashboard type definitions"
```

---

### Task 2: 创建额度检测模块

**Files:**
- Create: `src/web/quota.ts`

- [ ] **Step 1: 创建 src/web 目录**

Run: `mkdir -p src/web`

- [ ] **Step 2: 编写 quota.ts**

创建 `src/web/quota.ts`：

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { QuotaInfo, AgentType } from '../types.js';

export async function readClaudeQuota(): Promise<QuotaInfo | undefined> {
  const home = os.homedir();
  const statsPath = path.join(home, '.claude', 'stats-cache.json');

  try {
    const content = await fs.readFile(statsPath, 'utf-8');
    const stats = JSON.parse(content);

    const quota: QuotaInfo = {
      agent: 'cc',
      planType: 'Claude Code',
    };

    // 解析 modelUsage 获取总 token 用量
    if (stats.modelUsage && typeof stats.modelUsage === 'object') {
      let totalInput = 0;
      let totalOutput = 0;
      for (const model of Object.values(stats.modelUsage) as Array<Record<string, unknown>>) {
        totalInput += (model.inputTokens as number) || 0;
        totalOutput += (model.outputTokens as number) || 0;
      }
      if (totalInput > 0 || totalOutput > 0) {
        quota.totalInputTokens = totalInput;
        quota.totalOutputTokens = totalOutput;
      }
    }

    // 解析 dailyActivity
    if (Array.isArray(stats.dailyActivity)) {
      quota.dailyActivity = stats.dailyActivity.map((d: Record<string, unknown>) => ({
        date: d.date as string,
        messageCount: (d.messageCount as number) || 0,
        sessionCount: (d.sessionCount as number) || 0,
      }));
    }

    // 读取 settings.json 检测是否使用代理
    const settingsPath = path.join(home, '.claude', 'settings.json');
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
      if (settings.env?.ANTHROPIC_BASE_URL) {
        quota.planType = '代理模式';
      }
    } catch { /* ignore */ }

    return quota;
  } catch {
    return undefined;
  }
}

export async function readCodexQuota(): Promise<QuotaInfo | undefined> {
  const home = os.homedir();
  const authPath = path.join(home, '.codex', 'auth.json');

  try {
    const content = await fs.readFile(authPath, 'utf-8');
    const auth = JSON.parse(content);

    const quota: QuotaInfo = { agent: 'codex' };

    // 解码 JWT 获取 plan type 和订阅日期
    if (auth.tokens?.id_token) {
      try {
        const payload = decodeJwtPayload(auth.tokens.id_token);
        if (payload.chatgpt_plan_type) {
          quota.planType = String(payload.chatgpt_plan_type).toUpperCase();
        }
        if (payload.chatgpt_subscription_active_start) {
          quota.subscriptionStart = payload.chatgpt_subscription_active_start;
        }
        if (payload.chatgpt_subscription_active_until) {
          quota.subscriptionEnd = payload.chatgpt_subscription_active_until;
        }
      } catch { /* JWT decode failed */ }
    }

    return quota;
  } catch {
    return undefined;
  }
}

export async function readCopilotQuota(): Promise<QuotaInfo | undefined> {
  // Copilot 没有本地额度文件
  return undefined;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误输出

- [ ] **Step 4: 提交**

```bash
git add src/web/quota.ts
git commit -m "feat: add quota detection module for Claude Code and Codex"
```

---

### Task 3: 创建 HTTP 服务器

**Files:**
- Create: `src/web/server.ts`

- [ ] **Step 1: 编写 server.ts**

创建 `src/web/server.ts`：

```typescript
import http from 'node:http';
import { exec } from 'node:child_process';
import type { AgentType, SessionGroup, SessionDetail, SessionTokenData } from '../types.js';
import { ScannerRegistry } from '../scanners/registry.js';
import { readClaudeQuota, readCodexQuota, readCopilotQuota } from './quota.js';
import { getDashboardHtml } from './html.js';

export async function startServer(options: {
  groups: SessionGroup[];
  port?: number;
}): Promise<void> {
  const { groups, port } = options;
  const registry = new ScannerRegistry();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);

    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getDashboardHtml());
        return;
      }

      if (url.pathname === '/api/stats') {
        const agents = [];
        const quotaFns: Record<AgentType, () => Promise<import('../types.js').QuotaInfo | undefined>> = {
          cc: readClaudeQuota,
          codex: readCodexQuota,
          copilot: readCopilotQuota,
        };

        for (const group of groups) {
          const totalSize = group.sessions.reduce((s, sess) => s + sess.size, 0);
          const sorted = [...group.sessions].sort((a, b) => a.lastModified - b.lastModified);
          const quota = await quotaFns[group.agent]();

          agents.push({
            agent: group.agent,
            sessionCount: group.sessions.length,
            totalSize,
            oldestSession: sorted[0]
              ? { name: sorted[0].name, lastModified: sorted[0].lastModified }
              : undefined,
            newestSession: sorted[sorted.length - 1]
              ? { name: sorted[sorted.length - 1].name, lastModified: sorted[sorted.length - 1].lastModified }
              : undefined,
            quota,
          });
        }

        const totalSessions = groups.reduce((s, g) => s + g.sessions.length, 0);
        const totalSize = groups.reduce((s, g) => s + g.sessions.reduce((ss, sess) => ss + sess.size, 0), 0);

        json(res, { agents, totalSessions, totalSize });
        return;
      }

      const tokenMatch = url.pathname.match(/^\/api\/tokens\/(cc|copilot|codex)$/);
      if (tokenMatch) {
        const agent = tokenMatch[1] as AgentType;
        const sessions = await registry.discoverByAgent(agent);
        const scanner = registry.get(agent);

        const results: SessionTokenData[] = [];
        for (const session of sessions) {
          const entry: SessionTokenData = {
            id: session.id,
            name: session.name,
            size: session.size,
            lastModified: session.lastModified,
          };

          if (scanner?.inspect) {
            try {
              const detail = await scanner.inspect(session);
              entry.tokenUsage = detail.tokenUsage;
              entry.messageCount = detail.messageCount;
            } catch { /* skip */ }
          }

          results.push(entry);
        }

        json(res, { sessions: results });
        return;
      }

      const sessionMatch = url.pathname.match(/^\/api\/session\/(cc|copilot|codex)\/(.+)$/);
      if (sessionMatch) {
        const agent = sessionMatch[1] as AgentType;
        const id = decodeURIComponent(sessionMatch[2]);
        const sessions = await registry.discoverByAgent(agent);
        const session = sessions.find((s) => s.id === id || s.id.startsWith(id));

        if (!session) {
          json(res, { error: 'Session not found' }, 404);
          return;
        }

        const scanner = registry.get(agent);
        if (scanner?.inspect) {
          const detail = await scanner.inspect(session);
          json(res, detail);
        } else {
          json(res, { session, error: 'Inspect not supported' });
        }
        return;
      }

      json(res, { error: 'Not found' }, 404);
    } catch (err) {
      json(res, { error: (err as Error).message }, 500);
    }
  });

  const listenPort = port || 0;
  server.listen(listenPort, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : listenPort;
    const url = `http://localhost:${actualPort}`;

    console.log('');
    console.log(`  Vibe Session Stats`);
    console.log(`  Dashboard running at: ${url}`);
    console.log(`  Press Ctrl+C to stop`);
    console.log('');

    // 自动打开浏览器
    const cmd = process.platform === 'win32' ? 'start'
      : process.platform === 'darwin' ? 'open'
      : 'xdg-open';
    exec(`${cmd} ${url}`);
  });

  // 优雅退出
  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 编译错误 — `getDashboardHtml` 尚未定义（html.ts 还未创建），这是预期的

- [ ] **Step 3: 提交（暂存，后续 Task 完成后一起编译）**

```bash
git add src/web/server.ts
git commit -m "feat: add HTTP server with API routes for dashboard"
```

---

### Task 4: 创建仪表盘 HTML

**Files:**
- Create: `src/web/html.ts`

- [ ] **Step 1: 编写 html.ts**

创建 `src/web/html.ts`，内容为导出 `getDashboardHtml()` 函数，返回完整的 HTML 字符串。HTML 包含：

**CSS 部分要点：**
- `--bg: #1a1a2e`, `--surface: rgba(255,255,255,0.05)`, `--text: #e0e0e0`, `--text-dim: #888`
- `--cc: #CC7832`, `--copilot: #00B8D4`, `--codex: #10A37F`
- 卡片用 `backdrop-filter: blur(10px)` + `border: 1px solid rgba(255,255,255,0.1)`
- 响应式：`@media (max-width: 768px)` 卡片堆叠

**JS 部分要点：**
- `fetch('/api/stats')` 加载概览数据，渲染 3 个 agent 卡片
- 点击卡片 → `fetch('/api/tokens/${agent}')` → 渲染详情表格
- 表头点击排序（大小、token 用量、时间）
- 刷新按钮重新调用 `/api/stats`
- token 数字用 `toLocaleString()` 格式化
- 大小用自定义 `formatBytes()` 函数
- 相对时间用自定义 `formatRelativeTime()` 函数

**HTML 结构：**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vibe Session Stats</title>
  <style>/* 完整 CSS */</style>
</head>
<body>
  <header>
    <h1>Vibe Session Stats</h1>
    <button id="refresh">刷新</button>
  </header>

  <section id="account-info"><!-- 账号信息 --></section>

  <section id="overview">
    <!-- 3 个 agent 卡片，JS 动态渲染 -->
  </section>

  <section id="detail" style="display:none">
    <!-- 点击卡片后展开的详情区域 -->
  </section>

  <script>/* 完整 JS */</script>
</body>
</html>
```

由于此文件较长（约 400-500 行），完整代码在实现时编写。核心结构如下：

```typescript
export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vibe Session Stats</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #1a1a2e;
      --surface: rgba(255,255,255,0.05);
      --surface-hover: rgba(255,255,255,0.1);
      --border: rgba(255,255,255,0.1);
      --text: #e0e0e0;
      --text-dim: #888;
      --cc: #CC7832;
      --copilot: #00B8D4;
      --codex: #10A37F;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 24px;
    }
    /* ... 更多 CSS ... */
  </style>
</head>
<body>
  <!-- ... HTML 结构 ... -->
  <script>
    // ... JS 逻辑 ...
  </script>
</body>
</html>`;
}
```

- [ ] **Step 2: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误输出（server.ts 中的 import 现在可以解析了）

- [ ] **Step 3: 提交**

```bash
git add src/web/html.ts
git commit -m "feat: add dashboard HTML with inline CSS and JS"
```

---

### Task 5: 修改 index.ts 接入 Web 服务

**Files:**
- Modify: `src/index.ts:351-364` (stats 命令定义)

- [ ] **Step 1: 添加 import**

在 `src/index.ts` 顶部 import 区域添加：

```typescript
import { startServer } from './web/server.js';
```

- [ ] **Step 2: 替换 stats 命令**

将 `src/index.ts` 中第 351-364 行的 stats 命令替换为：

```typescript
// ─── stats ────────────────────────────────────────────────────────
program
  .command('stats')
  .description('Launch web dashboard for session statistics')
  .option('-p, --port <number>', 'Port number for the web server', parseInt)
  .action(async (options) => {
    const registry = new ScannerRegistry();
    try {
      const groups = await registry.discoverAll();
      await startServer({ groups, port: options.port });
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });
```

- [ ] **Step 3: 验证编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误输出

- [ ] **Step 4: 提交**

```bash
git add src/index.ts
git commit -m "feat: wire up stats command to launch web dashboard"
```

---

### Task 6: 构建并手动测试

**Files:**
- None (验证步骤)

- [ ] **Step 1: 完整构建**

Run: `npm run build`
Expected: 编译成功，无错误

- [ ] **Step 2: 启动仪表盘**

Run: `node dist/index.js stats`
Expected:
- 终端显示 "Dashboard running at: http://localhost:XXXX"
- 浏览器自动打开仪表盘页面
- 页面显示 3 个 agent 卡片（Claude Code、Copilot、Codex）
- 每个卡片显示会话数量和存储大小

- [ ] **Step 3: 测试 token 用量加载**

在浏览器中点击 Claude Code 卡片：
- 显示 loading 动画
- 加载完成后显示 token 用量汇总和会话列表
- 会话列表包含每个会话的 token 用量

- [ ] **Step 4: 测试会话详情**

在会话列表中点击某个会话：
- 显示会话详情（消息数、首尾消息、token 用量）

- [ ] **Step 5: 测试刷新**

点击刷新按钮：
- 数据重新加载

- [ ] **Step 6: 测试 Ctrl+C 退出**

在终端按 Ctrl+C：
- 服务器停止，进程退出

- [ ] **Step 7: 最终提交**

```bash
git add -A
git commit -m "feat: add web stats dashboard for vibe stats command"
```
