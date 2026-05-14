import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ReasonixScanner } from '../src/scanners/reasonix-scanner.js';

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-reasonix-'));

  process.env.HOME = home;
  process.env.USERPROFILE = home;

  try {
    return await fn(home);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    await fs.rm(home, { recursive: true, force: true });
  }
}

test('discovers Reasonix session-state events and extracts details', async () => {
  await withTempHome(async (home) => {
    const sessionDir = path.join(home, '.reasonix', 'session-state', 'abc123');
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, 'workspace.json'),
      JSON.stringify({ rootDir: 'D:\\Code\\demo-app' }),
      'utf-8',
    );
    await fs.writeFile(
      eventsPath,
      [
        JSON.stringify({ role: 'user', content: 'please inspect the auth flow' }),
        JSON.stringify({
          role: 'assistant',
          content: 'I will inspect it.',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 25,
            total_tokens: 125,
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 20,
          },
        }),
        '',
      ].join('\n'),
      'utf-8',
    );

    const scanner = new ReasonixScanner();
    const sessions = await scanner.discover();

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].agent, 'reasonix');
    assert.equal(sessions[0].id, 'abc123');
    assert.equal(sessions[0].name, 'D:\\Code\\demo-app');
    assert.equal(sessions[0].path, eventsPath);

    const detail = await scanner.inspect(sessions[0]);
    assert.equal(detail.messageCount, 2);
    assert.equal(detail.firstUserMessage, 'please inspect the auth flow');
    assert.equal(detail.lastUserMessage, 'please inspect the auth flow');
    assert.deepEqual(detail.tokenUsage, {
      input: 100,
      output: 25,
      total: 125,
      cacheRead: 80,
      cacheCreate: 20,
    });
  });
});

test('deletes an entire Reasonix session directory for events.jsonl sessions', async () => {
  await withTempHome(async (home) => {
    const sessionDir = path.join(home, '.reasonix', 'sessions', 'delete-me');
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(eventsPath, `${JSON.stringify({ role: 'user', content: 'cleanup' })}\n`);

    const scanner = new ReasonixScanner();
    const sessions = await scanner.discover();

    assert.equal(sessions.length, 1);
    assert.equal(await scanner.delete(sessions[0]), true);
    await assert.rejects(fs.stat(sessionDir));
  });
});
