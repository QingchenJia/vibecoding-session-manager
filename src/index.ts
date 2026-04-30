#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { ScannerRegistry } from './scanners/registry.js';
import { displaySessionGroups, displayJson, displayStats } from './ui/display.js';
import { interactiveDelete } from './ui/interactive.js';
import { formatBytes } from './utils/formatters.js';
import type { AgentType, SessionGroup } from './types.js';

const VALID_AGENTS: AgentType[] = [
  'claude-code',
  'cursor',
  'copilot',
  'windsurf',
  'codex',
];

function parseAgent(value: string): AgentType {
  if (!VALID_AGENTS.includes(value as AgentType)) {
    throw new Error(
      `Invalid agent: "${value}". Valid: ${VALID_AGENTS.join(', ')}`,
    );
  }
  return value as AgentType;
}

const program = new Command();

program
  .name('vibe')
  .description('Manage AI coding agent sessions')
  .version('0.1.0');

// ─── list ──────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all discovered sessions grouped by agent')
  .option('-a, --agent <agent>', 'Filter by agent type')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const registry = new ScannerRegistry();
    let groups: SessionGroup[];

    try {
      if (options.agent) {
        const agent = parseAgent(options.agent);
        const sessions = await registry.discoverByAgent(agent);
        groups = sessions.length > 0 ? [{ agent, sessions }] : [];
      } else {
        groups = await registry.discoverAll();
      }

      if (options.json) {
        displayJson(groups);
      } else {
        displaySessionGroups(groups);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── delete (interactive) ─────────────────────────────────────────
program
  .command('delete')
  .description('Interactively select and delete sessions')
  .option('-a, --agent <agent>', 'Filter by agent type')
  .option('--all', 'Delete ALL sessions (use with --agent for a specific agent)')
  .action(async (options) => {
    const registry = new ScannerRegistry();

    try {
      let groups: SessionGroup[];

      if (options.agent) {
        const agent = parseAgent(options.agent);
        const sessions = await registry.discoverByAgent(agent);
        groups = sessions.length > 0 ? [{ agent, sessions }] : [];
      } else {
        groups = await registry.discoverAll();
      }

      if (options.all) {
        const allSessions = groups.flatMap((g) => g.sessions);
        if (allSessions.length === 0) {
          console.log(chalk.yellow('No sessions found to delete.'));
          return;
        }
        const scope = options.agent
          ? `ALL ${allSessions.length} "${options.agent}" sessions`
          : `ALL ${allSessions.length} sessions across all agents`;
        console.log(chalk.red(`\n  WARNING: This will delete ${scope}.`));
        const { confirm } = await import('@inquirer/prompts');
        const confirmed = await confirm({
          message: `Delete ${allSessions.length} sessions?`,
          default: false,
        });
        if (!confirmed) {
          console.log(chalk.yellow('Deletion cancelled.'));
          return;
        }
        let deleted = 0;
        let freed = 0;
        for (const session of allSessions) {
          const scanner = registry.get(session.agent);
          if (scanner && (await scanner.delete(session))) {
            deleted++;
            freed += session.size;
          }
        }
        console.log(
          chalk.green(
            `\n  Deleted ${deleted}/${allSessions.length} sessions, ${formatBytes(freed)} freed.`,
          ),
        );
        return;
      }

      await interactiveDelete(groups, registry);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── delete-id ────────────────────────────────────────────────────
program
  .command('delete-id')
  .description('Delete a session by its ID')
  .argument('<id>', 'Session ID to delete')
  .requiredOption('-a, --agent <agent>', 'Agent type owning the session')
  .action(async (id: string, options) => {
    const registry = new ScannerRegistry();

    try {
      const agent = parseAgent(options.agent);
      const sessions = await registry.discoverByAgent(agent);
      const session = sessions.find((s) => s.id === id);

      if (!session) {
        console.error(chalk.red(`Session not found: ${id}`));
        process.exit(1);
      }

      console.log(
        `Deleting: ${chalk.cyan(session.name)} (${formatBytes(session.size)})`,
      );
      const scanner = registry.get(agent);
      if (scanner && (await scanner.delete(session))) {
        console.log(chalk.green('Deleted successfully.'));
      } else {
        console.error(chalk.red('Failed to delete session.'));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── prune ────────────────────────────────────────────────────────
program
  .command('prune')
  .description('Delete sessions older than N days')
  .requiredOption(
    '-d, --older-than-days <days>',
    'Delete sessions older than this many days',
    parseInt,
  )
  .option('-a, --agent <agent>', 'Only prune from this agent')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .action(async (options) => {
    const registry = new ScannerRegistry();
    const cutoff = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000;

    try {
      let groups: SessionGroup[];
      if (options.agent) {
        const agent = parseAgent(options.agent);
        const sessions = await registry.discoverByAgent(agent);
        groups = sessions.length > 0 ? [{ agent, sessions }] : [];
      } else {
        groups = await registry.discoverAll();
      }

      const oldSessions = groups.flatMap((g) =>
        g.sessions.filter((s) => s.lastModified < cutoff),
      );

      if (oldSessions.length === 0) {
        console.log(
          chalk.yellow(
            `No sessions older than ${options.olderThanDays} days found.`,
          ),
        );
        return;
      }

      const totalSize = oldSessions.reduce((sum, s) => sum + s.size, 0);
      console.log(
        chalk.yellow(
          `\n  Found ${oldSessions.length} sessions older than ${options.olderThanDays} days (${formatBytes(totalSize)}):`,
        ),
      );

      for (const s of oldSessions) {
        const days = Math.round((Date.now() - s.lastModified) / (24 * 60 * 60 * 1000));
        console.log(
          `  ${chalk.dim(s.id.slice(0, 8))}  ${s.name.slice(0, 50)}  ${chalk.dim(`~${days}d ago`)} ${formatBytes(s.size)}`,
        );
      }

      if (options.dryRun) {
        console.log(
          chalk.cyan('\n  Dry run — no sessions were deleted.'),
        );
        return;
      }

      const { confirm } = await import('@inquirer/prompts');
      const confirmed = await confirm({
        message: `\n  Delete these ${oldSessions.length} sessions?`,
        default: false,
      });

      if (!confirmed) {
        console.log(chalk.yellow('Deletion cancelled.'));
        return;
      }

      let deleted = 0;
      let freed = 0;
      for (const session of oldSessions) {
        const scanner = registry.get(session.agent);
        if (scanner && (await scanner.delete(session))) {
          deleted++;
          freed += session.size;
        }
      }
      console.log(
        chalk.green(
          `\n  Deleted ${deleted}/${oldSessions.length} sessions, ${formatBytes(freed)} freed.`,
        ),
      );
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── stats ────────────────────────────────────────────────────────
program
  .command('stats')
  .description('Show disk usage summary for all agents')
  .action(async () => {
    const registry = new ScannerRegistry();
    try {
      const groups = await registry.discoverAll();
      displayStats(groups);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();
