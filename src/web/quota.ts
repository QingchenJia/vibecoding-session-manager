import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import type { QuotaInfo } from '../types.js';

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

    if (Array.isArray(stats.dailyActivity)) {
      quota.dailyActivity = stats.dailyActivity.map((d: Record<string, unknown>) => ({
        date: d.date as string,
        messageCount: (d.messageCount as number) || 0,
        sessionCount: (d.sessionCount as number) || 0,
      }));
    }

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

    // 调用 ChatGPT API 获取实时配额
    if (auth.tokens?.access_token) {
      try {
        const usage = await fetchCodexUsage(auth.tokens.access_token);
        if (usage?.rate_limit) {
          const rl = usage.rate_limit as Record<string, unknown>;
          const primary = rl.primary_window as Record<string, unknown> | undefined;
          const secondary = rl.secondary_window as Record<string, unknown> | undefined;
          if (primary?.used_percent != null) {
            quota.remaining5hPercent = 100 - (primary.used_percent as number);
          }
          if (secondary?.used_percent != null) {
            quota.remaining1wPercent = 100 - (secondary.used_percent as number);
          }
        }
      } catch { /* API call failed */ }
    }

    return quota;
  } catch {
    return undefined;
  }
}

export async function readCopilotQuota(): Promise<QuotaInfo | undefined> {
  return undefined;
}

export async function readReasonixQuota(): Promise<QuotaInfo | undefined> {
  return undefined;
}

function fetchCodexUsage(accessToken: string): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'chatgpt.com',
      path: '/backend-api/codex/usage',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
        'User-Agent': 'codex-cli/0.129.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch { resolve(undefined); }
        } else {
          resolve(undefined);
        }
      });
    });
    req.on('error', () => resolve(undefined));
    req.setTimeout(10000, () => { req.destroy(); resolve(undefined); });
    req.end();
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}
