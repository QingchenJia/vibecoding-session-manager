# Web Stats Dashboard Design

**Date:** 2026-05-09
**Status:** Draft

## 概述

将 `vibe stats` 命令从简单的终端输出升级为启动本地 Web 服务器，在浏览器中展示详细的会话统计数据仪表盘。

## 架构

### 新增模块

```
src/web/
  server.ts      -- HTTP 服务器、API 路由
  html.ts        -- HTML/CSS/JS 仪表盘（模板字符串）
```

### 命令行为

`vibe stats` 命令：
1. 调用 `ScannerRegistry.discoverAll()` 获取所有会话数据
2. 启动 HTTP 服务器（默认随机端口，支持 `--port` 指定）
3. 自动打开浏览器
4. 终端显示访问地址，按 Ctrl+C 退出

### CLI 参数

```
vibe stats [--port <number>]
```

- `--port`: 指定端口，默认随机可用端口

### API 端点

| 端点 | 方法 | 返回内容 |
|------|------|---------|
| `/` | GET | HTML 仪表盘页面 |
| `/api/stats` | GET | 基础统计数据：会话数量、大小、账号信息 |
| `/api/tokens/:agent` | GET | 指定 agent 的 token 用量（懒加载） |
| `/api/session/:agent/:id` | GET | 单个会话详情 |

### 数据流

```
浏览器 → GET / → 加载仪表盘
浏览器 → GET /api/stats → 返回基础数据（秒级）
用户点击 agent 卡片
浏览器 → GET /api/tokens/cc → 服务器逐个 inspect 会话 → 返回 token 聚合数据
用户点击会话行
浏览器 → GET /api/session/cc/abc123 → 返回会话详情
```

## 仪表盘 UI

### 布局

```
┌─────────────────────────────────────────────────┐
│  Vibe Session Stats                    [刷新]    │
├─────────────────────────────────────────────────┤
│  账号信息栏                                      │
│  Claude Code: 代理模式  │  Codex: Plus 订阅      │
│  订阅有效期: 2026-04-15 ~ 2026-05-15            │
├─────────────────────────────────────────────────┤
│  概览卡片（3列）                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Claude   │ │ Copilot  │ │ Codex    │        │
│  │ 12 会话  │ │ 5 会话   │ │ 8 会话   │        │
│  │ 45.2MB   │ │ 12.1MB   │ │ 23.4MB   │        │
│  │ 点击加载  │ │ 点击加载  │ │ 点击加载  │        │
│  │ token用量 │ │ token用量 │ │ token用量 │        │
│  └──────────┘ └──────────┘ └──────────┘        │
├─────────────────────────────────────────────────┤
│  Agent 详情（点击卡片后展开）                      │
│  ┌──────────────────────────────────────────┐   │
│  │ Claude Code - Token 用量汇总              │   │
│  │ Input: 1,234,567  Output: 456,789        │   │
│  │ 总计: 1,691,356 tokens                   │   │
│  ├──────────────────────────────────────────┤   │
│  │ 会话列表（按 token 用量排序）              │   │
│  │ 会话ID  │ 项目名 │ 大小  │ Token用量 │ 时间│   │
│  │ abc123  │ my-app │ 2.1MB │ 123,456   │ 2h │   │
│  │ def456  │ api    │ 1.8MB │ 98,765    │ 1d │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 视觉风格

- 深色背景 #1a1a2e，卡片毛玻璃效果
- Agent 品牌色：Claude Code #CC7832、Copilot #00B8D4、Codex #10A37F
- 大字号数字突出显示数据，辅助信息小字灰色
- 纯 CSS，无外部依赖，响应式布局

### 交互

- 初始只加载基础数据（数量、大小），秒开
- 点击 agent 卡片后加载 token 用量，显示 loading 动画
- 会话列表支持按大小/token用量/时间排序（点击表头）
- 右上角刷新按钮重新扫描数据

## 额度检测

### Claude Code

数据源：`~/.claude/stats-cache.json`
- 读取 `modelUsage` 获取各模型的 token 用量统计
- 读取 `dailyModelTokens` 获取每日 token 用量趋势
- 读取 `dailyActivity` 获取每日消息数和会话数
- 读取 `settings.json` 的 `env.ANTHROPIC_BASE_URL` 判断是否使用代理

本地无法获取精确的 5h/1week 剩余额度（无 rate limit 数据存储），展示已用量统计。

### Codex

数据源：`~/.codex/auth.json`
- 解码 JWT 中的 `chatgpt_plan_type` 获取计划类型（plus/pro 等）
- 读取 `chatgpt_subscription_active_start` 和 `chatgpt_subscription_active_until` 获取订阅有效期
- 从 `logs_2.sqlite` 查询历史使用记录统计用量

### GitHub Copilot

数据源：VS Code globalStorage
- 扫描 Copilot 扩展配置检测计划类型
- 如果无法检测，显示"未检测到账号信息"

### 降级策略

- 任何文件读取失败不影响其他功能
- 无法检测的账号显示"未检测到账号信息"
- 额度区域为空时隐藏，不显示空白占位

## 实现细节

### server.ts

```typescript
// 核心接口
export async function startServer(options: { port?: number }): Promise<void>
```

- 使用 `node:http` 创建服务器
- 路由：解析 URL path 分发到对应处理器
- JSON 响应设置 `Content-Type: application/json`
- HTML 响应设置 `Content-Type: text/html; charset=utf-8`
- CORS 不需要（同源请求）
- 服务器启动后用 `child_process.exec` 调用系统命令打开浏览器

### html.ts

```typescript
// 导出 HTML 字符串
export function getDashboardHtml(): string
```

- 单个模板字符串包含完整 HTML + CSS + JS
- 使用 fetch API 调用后端接口
- 使用 CSS Grid/Flexbox 布局
- 使用 CSS 变量管理主题色
- 使用原生 DOM API 操作，无框架依赖

### 数据获取模块

新增 `src/web/quota.ts`：
- `readClaudeQuota()` -- 读取 `~/.claude/stats-cache.json`
- `readCodexQuota()` -- 解码 `~/.codex/auth.json` JWT
- `readCopilotQuota()` -- 扫描 VS Code 配置

### index.ts 修改

```typescript
program
  .command('stats')
  .description('Launch web dashboard for session statistics')
  .option('-p, --port <number>', 'Port number')
  .action(async (options) => {
    const registry = new ScannerRegistry();
    const groups = await registry.discoverAll();
    await startServer({ groups, port: options.port });
  });
```

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/web/server.ts` | 新增 | HTTP 服务器和 API 路由 |
| `src/web/html.ts` | 新增 | 仪表盘 HTML/CSS/JS |
| `src/web/quota.ts` | 新增 | 额度/账号检测逻辑 |
| `src/index.ts` | 修改 | stats 命令改为启动 web 服务 |
| `src/types.ts` | 修改 | 新增 QuotaInfo 类型 |

## 不做的事

- 不添加新的 npm 依赖（使用 Node.js 内置 http）
- 不引入前端构建工具
- 不实现 WebSocket/SSE（简单轮询刷新即可）
- 不存储历史数据（每次打开重新扫描）
