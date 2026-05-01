#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { ScannerRegistry } from './scanners/registry.js';
import { displaySessionGroups, displayJson, displayStats, getAgentDisplayName } from './ui/display.js';
import { displayInspect } from './ui/inspect.js';
import { interactiveDelete } from './ui/interactive.js';
import { formatBytes } from './utils/formatters.js';
import { SkillRegistry } from './skills/skill-registry.js';
import { displaySkillOverview, displaySkillJson, displaySkillInspect, displaySkillDiff } from './skills/display.js';
import { Doctor } from './doctor/doctor.js';
import { displayDoctorResults } from './doctor/display.js';
import { searchSessions } from './search/search.js';
import { displaySearchResults } from './search/display.js';
import type { AgentType, SessionGroup, SkillInfo } from './types.js';

const VALID_AGENTS: AgentType[] = ['cc', 'copilot', 'codex'];

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
  .version('0.1.0')
  .addHelpText('after', `\nSupported agents: ${VALID_AGENTS.map((a) => `${a} (${getAgentDisplayName(a)})`).join(', ')}\n`);

// ─── list ──────────────────────────────────────────────────────────
program
  .command('list')
  .description('List all discovered sessions grouped by agent')
  .option('-a, --agent <agent>', `Filter by agent (${VALID_AGENTS.join(', ')})`)
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
  .option('-a, --agent <agent>', `Filter by agent (${VALID_AGENTS.join(', ')})`)
  .option('--all', `Delete ALL sessions (use with --agent for a specific agent: ${VALID_AGENTS.join(', ')})`)
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
  .requiredOption('-a, --agent <agent>', `Agent owning the session (${VALID_AGENTS.join(', ')})`)
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
  .option('-a, --agent <agent>', `Only prune from this agent (${VALID_AGENTS.join(', ')})`)
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

// ─── search ───────────────────────────────────────────────────────
program
  .command('search')
  .description('Search session content across agents')
  .argument('<query>', 'Text to search for in session messages')
  .option('-a, --agent <agent>', `Filter by agent (${VALID_AGENTS.join(', ')})`)
  .option('-s, --since <days>', 'Only search sessions from the last N days', parseInt)
  .option('-n, --limit <count>', 'Limit results to N sessions', parseInt)
  .action(async (query: string, options) => {
    try {
      if (options.agent) parseAgent(options.agent);
      const since = options.since ? options.since * 24 * 60 * 60 * 1000 : undefined;
      const results = await searchSessions({
        query,
        agent: options.agent ? parseAgent(options.agent) : undefined,
        since,
        limit: options.limit,
      });
      displaySearchResults(results, query);
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

// ─── inspect ──────────────────────────────────────────────────────
program
  .command('inspect')
  .description('Show detailed information about a session')
  .argument('<id>', 'Session ID to inspect')
  .requiredOption('-a, --agent <agent>', `Agent owning the session (${VALID_AGENTS.join(', ')})`)
  .action(async (id: string, options) => {
    const agent = parseAgent(options.agent);
    const registry = new ScannerRegistry();

    try {
      const sessions = await registry.discoverByAgent(agent);
      const session = sessions.find((s) => s.id === id || s.id.includes(id));
      if (!session) {
        console.error(chalk.red(`Session not found: ${id}`));
        process.exit(1);
      }

      const scanner = registry.get(agent);
      if (!scanner || !scanner.inspect) {
        console.error(chalk.red(`Inspect not supported for ${agent}`));
        process.exit(1);
      }

      const detail = await scanner.inspect(session);
      displayInspect(detail);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── doctor ───────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Check agent installation health and detect issues')
  .action(async () => {
    const doctor = new Doctor();
    try {
      const results = await doctor.runAll();
      displayDoctorResults(results);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

// ─── skills ────────────────────────────────────────────────────────
const skillsCmd = program
  .command('skills')
  .description('List all personal skills and their agent registrations')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const registry = new SkillRegistry();
    try {
      const skills = await registry.discoverAll();
      const agents = registry.getKnownAgents();
      if (options.json) {
        displaySkillJson(skills, agents);
      } else {
        displaySkillOverview(skills, agents);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

skillsCmd
  .command('register')
  .description('Register a skill to a specific agent')
  .argument('<name>', 'Skill name to register')
  .requiredOption('-t, --to <agent>', `Target agent (${VALID_AGENTS.join(', ')})`)
  .option('-f, --from <agent>', `Source agent (${VALID_AGENTS.join(', ')})`)
  .action(async (name: string, options) => {
    const toAgent = parseAgent(options.to);
    const fromAgent = options.from ? parseAgent(options.from) : undefined;

    const registry = new SkillRegistry();
    try {
      const result = await registry.register(name, toAgent, fromAgent);
      if (result.success) {
        console.log(chalk.green(`\n  ${result.message}`));
      } else {
        console.error(chalk.red(`\n  ${result.message}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

skillsCmd
  .command('deregister')
  .description('Remove a skill from a specific agent')
  .argument('<name>', 'Skill name to deregister')
  .requiredOption('-f, --from <agent>', `Agent to remove from (${VALID_AGENTS.join(', ')})`)
  .action(async (name: string, options) => {
    const fromAgent = parseAgent(options.from);

    const registry = new SkillRegistry();
    try {
      const result = await registry.deregister(name, fromAgent);
      if (result.success) {
        console.log(chalk.green(`\n  ${result.message}`));
      } else {
        console.error(chalk.red(`\n  ${result.message}`));
        process.exit(1);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

skillsCmd
  .command('inspect')
  .description('Show detailed information about a skill')
  .argument('<name>', 'Skill name to inspect')
  .action(async (name: string) => {
    const registry = new SkillRegistry();
    try {
      const result = await registry.inspect(name);
      if (!result) {
        console.error(chalk.red(`\n  Skill "${name}" not found in any agent`));
        process.exit(1);
      }
      displaySkillInspect(result);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

skillsCmd
  .command('diff')
  .description('Compare a skill between two agents')
  .argument('<name>', 'Skill name to compare')
  .argument('<agent-a>', `First agent (${VALID_AGENTS.join(', ')})`)
  .argument('<agent-b>', `Second agent (${VALID_AGENTS.join(', ')})`)
  .action(async (name: string, a: string, b: string) => {
    const agentA = parseAgent(a);
    const agentB = parseAgent(b);
    const registry = new SkillRegistry();
    try {
      const result = await registry.diff(name, agentA, agentB);
      displaySkillDiff(result);
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
      process.exit(1);
    }
  });

program.parse();
