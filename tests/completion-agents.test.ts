import assert from 'node:assert/strict';
import test from 'node:test';
import { handleComplete } from '../src/completion.js';

test('completes current agent names and drops cc shorthand', async () => {
  assert.deepEqual(await handleComplete('vibe list -a cla', 16), ['claude']);
  assert.deepEqual(await handleComplete('vibe list -a gem', 16), ['gemini']);
  assert.deepEqual(await handleComplete('vibe list -a open', 17), ['opencode']);
  const cResults = await handleComplete('vibe list -a c', 14);
  assert.deepEqual(cResults, ['claude', 'copilot', 'codex']);
  assert.equal(cResults.includes('cc'), false);
});
