import http from 'node:http';
import { exec } from 'node:child_process';
import type { AgentType, SessionGroup, SessionTokenData } from '../types.js';
import { ScannerRegistry } from '../scanners/registry.js';
import { readClaudeQuota, readCodexQuota, readCopilotQuota } from './quota.js';
import { getDashboardHtml } from './html.js';

const QUOTA_CACHE_TTL = 30_000; // 30 seconds

export async function startServer(options: {
  groups: SessionGroup[];
  port?: number;
}): Promise<void> {
  const { groups, port } = options;
  const registry = new ScannerRegistry();

  // Quota cache to avoid hitting external APIs on every refresh
  const quotaCache = new Map<AgentType, { data: import('../types.js').QuotaInfo | undefined; ts: number }>();

  async function getCachedQuota(agent: AgentType): Promise<import('../types.js').QuotaInfo | undefined> {
    const cached = quotaCache.get(agent);
    if (cached && Date.now() - cached.ts < QUOTA_CACHE_TTL) {
      return cached.data;
    }
    const quotaFns: Record<AgentType, () => Promise<import('../types.js').QuotaInfo | undefined>> = {
      cc: readClaudeQuota,
      codex: readCodexQuota,
      copilot: readCopilotQuota,
    };
    const data = await quotaFns[agent]();
    if (data || !cached) {
      quotaCache.set(agent, { data, ts: Date.now() });
    }
    return data ?? cached?.data;
  }

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

        for (const group of groups) {
          const totalSize = group.sessions.reduce((s, sess) => s + sess.size, 0);
          const sorted = [...group.sessions].sort((a, b) => a.lastModified - b.lastModified);
          const quota = await getCachedQuota(group.agent);

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
