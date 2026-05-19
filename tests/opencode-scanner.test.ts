import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { OpenCodeScanner } from '../src/scanners/opencode-scanner.js';

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-opencode-'));

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

test('discovers OpenCode SQLite sessions and extracts details', async () => {
  await withTempHome(async (home) => {
    const opencodeDir = path.join(home, '.local', 'share', 'opencode');
    const dbPath = path.join(opencodeDir, 'opencode.db');
    await fs.mkdir(opencodeDir, { recursive: true });

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        directory TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        tokens_cache_read INTEGER NOT NULL DEFAULT 0,
        tokens_cache_write INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO session
        (id, title, directory, time_created, time_updated, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('ses_abc', 'Auth flow cleanup', 'D:\\Code\\demo-app', 1000, 2000, 100, 25, 10, 5);
    db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
      'msg_user',
      'ses_abc',
      1100,
      JSON.stringify({ role: 'user', parts: [{ type: 'text', text: 'clean up login redirects' }] }),
    );
    db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
      'msg_assistant',
      'ses_abc',
      1200,
      JSON.stringify({ role: 'assistant', parts: [{ type: 'text', text: 'I updated the redirects.' }] }),
    );
    db.close();

    const scanner = new OpenCodeScanner();
    const sessions = await scanner.discover();

    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].agent, 'opencode');
    assert.equal(sessions[0].id, 'ses_abc');
    assert.equal(sessions[0].name, 'Auth flow cleanup');
    assert.equal(sessions[0].path, dbPath);

    const detail = await scanner.inspect(sessions[0]);
    assert.equal(detail.messageCount, 2);
    assert.equal(detail.firstUserMessage, 'clean up login redirects');
    assert.equal(detail.lastUserMessage, 'clean up login redirects');
    assert.deepEqual(detail.tokenUsage, {
      input: 100,
      output: 25,
      total: 140,
      cacheRead: 10,
      cacheCreate: 5,
    });
  });
});

test('deletes OpenCode SQLite sessions and their messages', async () => {
  await withTempHome(async (home) => {
    const opencodeDir = path.join(home, '.local', 'share', 'opencode');
    const dbPath = path.join(opencodeDir, 'opencode.db');
    await fs.mkdir(opencodeDir, { recursive: true });

    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER, data TEXT NOT NULL);
    `);
    db.prepare('INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)').run(
      'ses_delete',
      'Delete me',
      'D:\\Code\\demo-app',
      1000,
      2000,
    );
    db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)').run(
      'msg_delete',
      'ses_delete',
      1100,
      JSON.stringify({ role: 'user', content: 'cleanup' }),
    );
    db.close();

    const scanner = new OpenCodeScanner();
    const sessions = await scanner.discover();

    assert.equal(sessions.length, 1);
    assert.equal(await scanner.delete(sessions[0]), true);

    const verifyDb = new Database(dbPath);
    const sessionCount = (verifyDb.prepare('SELECT count(*) as count FROM session').get() as { count: number }).count;
    const messageCount = (verifyDb.prepare('SELECT count(*) as count FROM message').get() as { count: number }).count;
    verifyDb.close();

    assert.equal(sessionCount, 0);
    assert.equal(messageCount, 0);
  });
});
