import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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
          quota.subscriptionStart = String(payload.chatgpt_subscription_active_start);
        }
        if (payload.chatgpt_subscription_active_until) {
          quota.subscriptionEnd = String(payload.chatgpt_subscription_active_until);
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
