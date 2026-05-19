import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GeminiScanner } from '../src/scanners/gemini-scanner.js';

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-gemini-'));

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

test('discovers Gemini CLI chat files and extracts details', async () => {
  await withTempHome(async (home) => {
    const chatsDir = path.join(home, '.gemini', 'tmp', 'projecthash', 'chats');
    const sessionPath = path.join(chatsDir, 'session-one.json');
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.writeFile(
      sessionPath,
      JSON.stringify({
        history: [
          { role: 'user', parts: [{ text: 'explain the auth flow' }] },
          { role: 'model', parts: [{ text: 'The auth flow starts at login.' }] },
        ],
        tokenUsage: {
          promptTokens: 40,
          completionTokens: 12,
          totalTokens: 52,
        },
      }),
      'utf-8',
    );

    const scanner = new GeminiScanner();
    const sessions = await scanner.discover();

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].agent, 'gemini');
    assert.equal(sessions[0].id, 'projecthash-session-one');
    assert.equal(sessions[0].name, 'explain the auth flow');
    assert.equal(sessions[0].path, sessionPath);

    const detail = await scanner.inspect(sessions[0]);
    assert.equal(detail.messageCount, 2);
    assert.equal(detail.firstUserMessage, 'explain the auth flow');
    assert.equal(detail.lastUserMessage, 'explain the auth flow');
    assert.deepEqual(detail.tokenUsage, { input: 40, output: 12, total: 52 });
  });
});

test('deletes Gemini CLI chat session files', async () => {
  await withTempHome(async (home) => {
    const chatsDir = path.join(home, '.gemini', 'tmp', 'projecthash', 'chats');
    const sessionPath = path.join(chatsDir, 'session-delete.json');
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.writeFile(
      sessionPath,
      JSON.stringify({ history: [{ role: 'user', parts: [{ text: 'cleanup' }] }] }),
      'utf-8',
    );

    const scanner = new GeminiScanner();
    const sessions = await scanner.discover();

    assert.equal(sessions.length, 1);
    assert.equal(await scanner.delete(sessions[0]), true);
    await assert.rejects(fs.stat(sessionPath));
  });
});
