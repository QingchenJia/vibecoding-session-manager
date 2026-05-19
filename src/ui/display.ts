import chalk, { type ChalkInstance } from 'chalk';
import type { SessionGroup, AgentType } from '../types.js';
import { formatRelativeTime, formatBytes, truncate } from '../utils/formatters.js';

const AGENT_COLORS: Record<AgentType, ChalkInstance> = {
  claude: chalk.hex('#CC7832'),
  copilot: chalk.hex('#00B8D4'),
  codex: chalk.hex('#10A37F'),
  reasonix: chalk.hex('#7C5CFF'),
  opencode: chalk.hex('#F97316'),
  gemini: chalk.hex('#4285F4'),
};

const AGENT_NAMES: Record<AgentType, string> = {
  claude: 'Claude Code',
  copilot: 'GitHub Copilot',
  codex: 'Codex (OpenAI)',
  reasonix: 'Reasonix',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
};

export function getAgentColor(agent: AgentType): ChalkInstance {
  return AGENT_COLORS[agent];
}

export function getAgentDisplayName(agent: AgentType): string {
  return AGENT_NAMES[agent];
}

export function displaySessionGroups(groups: SessionGroup[]): void {
  if (groups.length === 0) {
    console.log(chalk.yellow('\n  No sessions found.'));
    return;
  }

  let totalSessions = 0;
  let totalSize = 0;

  for (const group of groups) {
    totalSessions += group.sessions.length;
    totalSize += group.sessions.reduce((sum, s) => sum + s.size, 0);

    const color = getAgentColor(group.agent);
    const displayName = getAgentDisplayName(group.agent);

    console.log(color.bold(`\n  ${displayName}`));
    console.log(color(`  ${'─'.repeat(60)}`));

    for (const session of group.sessions) {
      const age = formatRelativeTime(session.lastModified);
      const sizeStr = formatBytes(session.size);
      console.log(
        `  ${chalk.dim(session.id.slice(0, 8))}  ` +
          `${truncate(session.name, 38).padEnd(38)} ` +
          `${chalk.dim(age.padStart(12))} ${chalk.dim(sizeStr.padStart(7))}`,
      );
    }

    const groupSize = group.sessions.reduce((sum, s) => sum + s.size, 0);
    console.log(
      color(
        `  ${group.sessions.length} sessions, ${formatBytes(groupSize)}`,
      ),
    );
  }

  console.log(
    chalk.bold(`\n  Total: ${totalSessions} sessions, ${formatBytes(totalSize)}`),
  );
}

export function displayJson(groups: SessionGroup[]): void {
  console.log(JSON.stringify(groups, null, 2));
}

export function displayStats(groups: SessionGroup[]): void {
  if (groups.length === 0) {
    console.log(chalk.yellow('No sessions found.'));
    return;
  }

  console.log(chalk.bold('\n  Session Storage Summary\n'));

  let grandTotalSessions = 0;
  let grandTotalSize = 0;

  for (const group of groups) {
    const color = getAgentColor(group.agent);
    const displayName = getAgentDisplayName(group.agent);
    const count = group.sessions.length;
    const size = group.sessions.reduce((sum, s) => sum + s.size, 0);

    grandTotalSessions += count;
    grandTotalSize += size;

    // Find oldest and newest
    const sorted = [...group.sessions].sort(
      (a, b) => a.lastModified - b.lastModified,
    );
    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];

    console.log(
      `  ${color.bold(displayName)}` +
        `\n    Sessions: ${count}` +
        `\n    Size:     ${formatBytes(size)}` +
        `\n    Oldest:   ${formatRelativeTime(oldest.lastModified)} (${oldest.name})` +
        `\n    Newest:   ${formatRelativeTime(newest.lastModified)} (${newest.name})` +
        `\n`,
    );
  }

  console.log(chalk.bold(`  Total: ${grandTotalSessions} sessions, ${formatBytes(grandTotalSize)}`));
}
