import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ScannerRegistry } from '../scanners/registry.js';
import { detectPlatform } from '../utils/platform.js';
import type { AgentType, Session, SessionGroup, SearchResult, SearchMatch } from '../types.js';

export interface SearchOptions {
  query: string;
  agent?: AgentType;
  since?: number; // milliseconds ago
  limit?: number;
}

export async function searchSessions(options: SearchOptions): Promise<SearchResult[]> {
  const registry = new ScannerRegistry();
  const platform = detectPlatform();
  const results: SearchResult[] = [];
  const terms = options.query.toLowerCase().split(/\s+/).filter(Boolean);

  let groups: SessionGroup[];
  if (options.agent) {
    const sessions = await registry.discoverByAgent(options.agent);
    groups = sessions.length > 0 ? [{ agent: options.agent, sessions }] : [];
  } else {
    groups = await registry.discoverAll();
  }

  // Apply since filter
  if (options.since) {
    const cutoff = Date.now() - options.since;
    for (const g of groups) {
      g.sessions = g.sessions.filter((s) => s.lastModified >= cutoff);
    }
    groups = groups.filter((g) => g.sessions.length > 0);
  }

  for (const group of groups) {
    for (const session of group.sessions) {
      const matches = await searchInSession(session, group.agent, terms, platform);
      if (matches.length > 0) {
        results.push({ session, matches });
      }
    }
  }

  // Sort by most recent match first
  results.sort((a, b) => b.session.lastModified - a.session.lastModified);

  if (options.limit) {
    return results.slice(0, options.limit);
  }
  return results;
}

async function searchInSession(
  session: Session,
  agent: AgentType,
  terms: string[],
  platform: ReturnType<typeof detectPlatform>,
): Promise<SearchMatch[]> {
  if (agent === 'cc') return searchCC(session, terms);
  if (agent === 'codex') return searchCodex(session, terms, platform);
  if (agent === 'copilot') return searchCopilot(session, terms);
  return [];
}

async function searchCC(session: Session, terms: string[]): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  try {
    const content = await fs.readFile(session.path, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== 'user') continue;
      const msg = entry.message as Record<string, unknown> | undefined;
      const text = (msg?.content as string) || '';
      const lower = text.toLowerCase();
      if (terms.every((t) => lower.includes(t))) {
        const idx = Math.max(0, lower.indexOf(terms[0]) - 40);
        const snippet = text.slice(idx, idx + 150);
        matches.push({ line: i + 1, content: text, snippet });
      }
    }
  } catch { /* skip */ }
  return matches;
}

async function searchCodex(
  session: Session,
  terms: string[],
  platform: ReturnType<typeof detectPlatform>,
): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  const codexDir = path.join(platform.homeDir, '.codex');

  // Search in SQLite threads table
  const stateDbPath = path.join(codexDir, 'state_5.sqlite');
  try {
    const db = new Database(stateDbPath);
    const row = db.prepare(
      'SELECT first_user_message, rollout_path FROM threads WHERE id = ?',
    ).get(session.id) as Record<string, unknown> | undefined;
    db.close();

    if (row?.first_user_message) {
      const text = row.first_user_message as string;
      const lower = text.toLowerCase();
      if (terms.every((t) => lower.includes(t))) {
        const idx = Math.max(0, lower.indexOf(terms[0]) - 40);
        matches.push({ line: 0, content: text, snippet: text.slice(idx, idx + 150) });
      }
    }

    // Also search rollout file if available
    if (row?.rollout_path) {
      const rp = path.join(codexDir, row.rollout_path as string);
      try {
        const rc = await fs.readFile(rp, 'utf-8');
        const lines = rc.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          let entry: Record<string, unknown>;
          try { entry = JSON.parse(line); } catch { continue; }
          if (entry.type === 'response_item' && entry.payload) {
            const payload = entry.payload as Record<string, unknown>;
            if (payload.role === 'user' && Array.isArray(payload.content)) {
              for (const block of payload.content as Array<Record<string, unknown>>) {
                if (block.type === 'input_text' && typeof block.text === 'string') {
                  const lower = block.text.toLowerCase();
                  if (terms.every((t) => lower.includes(t))) {
                    const idx = Math.max(0, lower.indexOf(terms[0]) - 40);
                    matches.push({ line: i + 1, content: block.text, snippet: block.text.slice(idx, idx + 150) });
                  }
                }
              }
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return matches;
}

async function searchCopilot(session: Session, terms: string[]): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  try {
    const content = await fs.readFile(session.path, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line); } catch { continue; }
      const role = entry.role as string;
      const text = (entry.content as string) || '';
      if (role !== 'user' || !text) continue;
      const lower = text.toLowerCase();
      if (terms.every((t) => lower.includes(t))) {
        const idx = Math.max(0, lower.indexOf(terms[0]) - 40);
        const snippet = text.slice(idx, idx + 150);
        matches.push({ line: i + 1, content: text, snippet });
      }
    }
  } catch { /* skip */ }
  return matches;
}
