import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { QuotaInfo } from '../types.js';

// Rolling window durations
const H5_MS = 5 * 60 * 60 * 1000;
const W1_MS = 7 * 24 * 60 * 60 * 1000;

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
        const authData = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
        if (authData?.chatgpt_plan_type) {
          quota.planType = String(authData.chatgpt_plan_type).toUpperCase();
        }
        if (authData?.chatgpt_subscription_active_start) {
          quota.subscriptionStart = String(authData.chatgpt_subscription_active_start).slice(0, 10);
        }
        if (authData?.chatgpt_subscription_active_until) {
          quota.subscriptionEnd = String(authData.chatgpt_subscription_active_until).slice(0, 10);
        }
      } catch { /* JWT decode failed */ }
    }

    // 从 SQLite 查询滚动窗口 token 用量
    const dbPath = path.join(home, '.codex', 'state_5.sqlite');
    try {
      const { default: Database } = await import('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const now = Date.now();
      const cutoff5h = now - H5_MS;
      const cutoff1w = now - W1_MS;

      const rows = db.prepare(
        'SELECT tokens_used, updated_at_ms, updated_at FROM threads'
      ).all() as Array<{ tokens_used: number | null; updated_at_ms: number | null; updated_at: number | null }>;
      db.close();

      let tokens5h = 0;
      let tokens1w = 0;
      for (const row of rows) {
        const updated = row.updated_at_ms || (row.updated_at ? row.updated_at * 1000 : 0);
        if (!updated) continue;
        const tokens = row.tokens_used || 0;
        if (updated >= cutoff1w) tokens1w += tokens;
        if (updated >= cutoff5h) tokens5h += tokens;
      }

      if (tokens5h > 0) quota.recentTokens5h = tokens5h;
      if (tokens1w > 0) quota.recentTokens1w = tokens1w;
    } catch { /* SQLite not available */ }

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
