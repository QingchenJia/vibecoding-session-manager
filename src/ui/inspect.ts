import chalk from 'chalk';
import type { SessionDetail } from '../types.js';
import { getAgentColor, getAgentDisplayName } from './display.js';
import { formatRelativeTime, formatBytes, formatNumber, truncate } from '../utils/formatters.js';

export function displayInspect(detail: SessionDetail): void {
  const s = detail.session;
  const color = getAgentColor(s.agent);
  const agentName = getAgentDisplayName(s.agent);

  console.log('');
  console.log(color.bold(`  ${agentName}`));
  console.log(color(`  ${'─'.repeat(50)}`));
  console.log(`  ${chalk.dim('Project:'.padEnd(16))} ${truncate(s.name, 60)}`);
  console.log(`  ${chalk.dim('Session ID:'.padEnd(16))} ${s.id}`);
  console.log(`  ${chalk.dim('Path:'.padEnd(16))} ${s.path}`);
  console.log(`  ${chalk.dim('Last active:'.padEnd(16))} ${formatRelativeTime(s.lastModified)}`);
  console.log(`  ${chalk.dim('Size:'.padEnd(16))} ${formatBytes(s.size)}`);

  if (detail.firstUserMessage) {
    console.log('');
    console.log(chalk.bold('  First user message:'));
    console.log(chalk.dim(`  ${truncate(detail.firstUserMessage, 120)}`));
  }

  if (detail.lastUserMessage && detail.lastUserMessage !== detail.firstUserMessage) {
    console.log('');
    console.log(chalk.bold('  Last user message:'));
    console.log(chalk.dim(`  ${truncate(detail.lastUserMessage, 120)}`));
  }

  if (detail.messageCount !== undefined) {
    console.log('');
    console.log(chalk.bold('  Message count:'));
    console.log(`  ${chalk.dim('Total:'.padEnd(12))} ${detail.messageCount}`);
  }

  if (detail.tokenUsage) {
    const tu = detail.tokenUsage;
    const fmt = (n: number | undefined) => (n != null && n > 0) ? formatNumber(n) : '-';
    console.log('');
    console.log(chalk.bold('  Token Usage:'));
    console.log(`  ${chalk.dim('Input:'.padEnd(16))} ${fmt(tu.input)}`);
    console.log(`  ${chalk.dim('Cache Hit:'.padEnd(16))} ${fmt(tu.cacheRead)}`);
    console.log(`  ${chalk.dim('Cache Create:'.padEnd(16))} ${fmt(tu.cacheCreate)}`);
    console.log(`  ${chalk.dim('Output:'.padEnd(16))} ${fmt(tu.output)}`);
    console.log(`  ${chalk.dim('Total:'.padEnd(16))} ${fmt(tu.total)}`);
  }

  if (detail.preview && detail.preview.length > 0) {
    console.log('');
    console.log(chalk.bold(`  Preview (first ${detail.preview.length} messages):`));
    for (const p of detail.preview) {
      console.log(chalk.dim(`  ${truncate(p, 120)}`));
    }
  }

  if (detail.rawFiles && detail.rawFiles.length > 0) {
    console.log('');
    console.log(chalk.bold('  Files:'));
    for (const f of detail.rawFiles) {
      console.log(chalk.dim(`  ${f}`));
    }
  }

  console.log('');
}
