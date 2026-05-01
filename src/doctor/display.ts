import chalk from 'chalk';
import type { AgentCheckResult } from './doctor.js';

const STATUS_MARK: Record<string, string> = {
  ok: chalk.green('●'),
  warning: chalk.yellow('◐'),
  error: chalk.red('✕'),
  info: chalk.dim('○'),
};

export function displayDoctorResults(results: AgentCheckResult[]): void {
  console.log(chalk.bold('\n  Health Check'));

  for (const result of results) {
    const hasIssues = result.issues.length > 0;
    const color = getResultColor(result);

    console.log(color.bold(`\n  ${result.displayName}`));
    console.log(color(`  ${'─'.repeat(40)}`));

    for (const check of result.checks) {
      const mark = STATUS_MARK[check.status] || chalk.dim('·');
      console.log(`  ${mark} ${check.label.padEnd(20)} ${chalk.dim(check.detail)}`);
    }

    if (hasIssues) {
      console.log(chalk.yellow(`\n  Issues:`));
      for (const issue of result.issues) {
        console.log(chalk.yellow(`  ⚡ ${issue}`));
      }
    } else {
      console.log(chalk.dim(`\n  Issues: none`));
    }
  }

  // Summary
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const allOk = totalIssues === 0;

  console.log('');
  if (allOk) {
    console.log(chalk.green('  All checks passed.'));
  } else {
    console.log(chalk.yellow(`  ${totalIssues} issue${totalIssues > 1 ? 's' : ''} found.`));
  }
  console.log('');
}

function getResultColor(result: AgentCheckResult): typeof chalk {
  const hasError = result.checks.some((c) => c.status === 'error');
  if (hasError) return chalk.red;
  const hasWarning = result.checks.some((c) => c.status === 'warning') || result.issues.length > 0;
  if (hasWarning) return chalk.yellow;
  return chalk.green;
}
