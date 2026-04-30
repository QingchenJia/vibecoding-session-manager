import { checkbox, confirm, select } from '@inquirer/prompts';
import chalk from 'chalk';
import type { Session, SessionGroup, AgentType } from '../types.js';
import type { ScannerRegistry } from '../scanners/registry.js';
import { formatRelativeTime, formatBytes, truncate } from '../utils/formatters.js';
import { getAgentDisplayName, getAgentColor } from './display.js';

export async function interactiveDelete(
  groups: SessionGroup[],
  registry: ScannerRegistry,
): Promise<void> {
  if (groups.length === 0) {
    console.log(chalk.yellow('No sessions found to delete.'));
    return;
  }

  // Step 1: Choose an agent group or "All"
  const flatSessions = groups.flatMap((g) => g.sessions); // eslint-disable-line

  const agentChoices: Array<{
    name: string;
    value: AgentType | 'all';
    description?: string; // eslint-disable-line
  }> = [
    {
      name: chalk.red.bold('All agents'),
      value: 'all',
      description: `${flatSessions.length} sessions, ${formatBytes(
        flatSessions.reduce((s, x) => s + x.size, 0),
      )}`,
    },
    ...groups.map((g) => {
      const color = getAgentColor(g.agent);
      const totalSize = g.sessions.reduce((s, x) => s + x.size, 0);
      return {
        name: color.bold(getAgentDisplayName(g.agent)),
        value: g.agent,
        description: `${g.sessions.length} sessions, ${formatBytes(totalSize)}`,
      };
    }),
  ];

  const chosenAgent = await select({
    message: 'Select an agent to manage:',
    choices: agentChoices,
    loop: false,
  });

  const targetSessions =
    chosenAgent === 'all'
      ? flatSessions
      : groups.find((g) => g.agent === chosenAgent)!.sessions;

  if (targetSessions.length === 0) {
    console.log(chalk.yellow('No sessions found for this agent.'));
    return;
  }

  // Step 2: Multi-select sessions to delete
  const selected = await checkbox({
    message: 'Select sessions to delete (space to toggle, enter to confirm):',
    pageSize: 15,
    loop: false,
    choices: targetSessions.map((s) => ({
      name: `${truncate(s.name, 45).padEnd(45)} ${formatRelativeTime(s.lastModified).padStart(12)} ${formatBytes(s.size).padStart(7)}`,
      value: s,
    })),
  });

  if (selected.length === 0) {
    console.log(chalk.yellow('No sessions selected.'));
    return;
  }

  // Step 3: Confirm
  const totalSize = selected.reduce((sum, s) => sum + s.size, 0);
  const confirmed = await confirm({
    message: `Delete ${chalk.red(String(selected.length))} session(s) (${formatBytes(totalSize)})? This cannot be undone.`,
    default: false,
  });

  if (!confirmed) {
    console.log(chalk.yellow('Deletion cancelled.'));
    return;
  }

  // Step 4: Execute with progress
  console.log();
  let deleted = 0;
  let freed = 0;
  for (const session of selected) {
    const scanner = registry.get(session.agent);
    if (!scanner) {
      console.log(`  ${chalk.red('✗')} ${truncate(session.name, 40)} — scanner not found`);
      continue;
    }

    process.stdout.write(
      `  ${chalk.dim('…')} Deleting ${chalk.cyan(truncate(session.name, 40))} ...`,
    );
    const success = await scanner.delete(session);
    if (success) {
      console.log(`\r  ${chalk.green('✓')} Deleted ${chalk.cyan(truncate(session.name, 40))} (${formatBytes(session.size)})`);
      deleted++;
      freed += session.size;
    } else {
      console.log(`\r  ${chalk.red('✗')} Failed to delete ${truncate(session.name, 40)}`);
    }
  }

  console.log(
    chalk.bold(
      `\n  Done: ${deleted}/${selected.length} deleted, ${formatBytes(freed)} freed.`,
    ),
  );
}
