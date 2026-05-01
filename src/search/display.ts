import chalk from 'chalk';
import type { SearchResult } from '../types.js';
import { getAgentColor, getAgentDisplayName } from '../ui/display.js';
import { formatRelativeTime, formatBytes, truncate } from '../utils/formatters.js';

export function displaySearchResults(
  results: SearchResult[],
  query: string,
): void {
  if (results.length === 0) {
    console.log(chalk.yellow(`\n  No sessions matching "${query}"`));
    return;
  }

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);
  console.log('');
  console.log(
    chalk.bold(
      `  ${totalMatches} match${totalMatches > 1 ? 'es' : ''} in ${results.length} session${results.length > 1 ? 's' : ''} for "${query}"`,
    ),
  );

  let lastAgent = '';
  for (const result of results) {
    const s = result.session;
    const color = getAgentColor(s.agent);
    const agentName = getAgentDisplayName(s.agent);

    if (s.agent !== lastAgent) {
      console.log(color.bold(`\n  ${agentName}`));
      lastAgent = s.agent;
    }

    console.log(
      `  ${chalk.dim('[' + s.id.slice(0, 8) + ']')} ${truncate(s.name, 28).padEnd(28)} ${chalk.dim(formatRelativeTime(s.lastModified).padStart(10))} ${chalk.dim(formatBytes(s.size).padStart(8))}`,
    );

    for (const match of result.matches.slice(0, 3)) {
      const highlighted = highlightTerms(match.snippet, query);
      console.log(`  ${chalk.dim('matched:')} ${highlighted}`);
    }

    if (result.matches.length > 3) {
      console.log(chalk.dim(`  ... and ${result.matches.length - 3} more matches`));
    }
  }

  console.log('');
}

function highlightTerms(text: string, query: string): string {
  const terms = query.split(/\s+/);
  let result = text;
  for (const term of terms) {
    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    result = result.replace(regex, chalk.yellow('$1'));
  }
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
