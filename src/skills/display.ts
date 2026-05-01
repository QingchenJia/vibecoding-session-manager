import chalk from 'chalk';
import type { AgentType, SkillInfo } from '../types.js';
import { getAgentColor, getAgentDisplayName } from '../ui/display.js';

export function displaySkillOverview(skills: SkillInfo[], agents: AgentType[]): void {
  if (skills.length === 0) {
    console.log(chalk.yellow('\n  No personal skills found.'));
    return;
  }

  // Header
  const nameCol = 32;
  const descCol = 48;
  const gap = 2;
  const colWidths = agents.map((a) => getAgentDisplayName(a).length + 2);

  let header = `\n  ${chalk.bold('Skill'.padEnd(nameCol))} ${chalk.bold('Description'.padEnd(descCol))}${' '.repeat(gap)}`;
  for (let i = 0; i < agents.length; i++) {
    const color = getAgentColor(agents[i]);
    const label = getAgentDisplayName(agents[i]);
    header += ' '.repeat(colWidths[i] - label.length) + color.bold(label);
  }
  console.log(header);

  // Separator
  let sep = `  ${'─'.repeat(nameCol + 1 + descCol + gap)}`;
  for (const w of colWidths) sep += '─'.repeat(w);
  console.log(chalk.dim(sep));

  // Rows
  for (const skill of skills) {
    const name = skill.name.padEnd(nameCol);
    const desc = (skill.description || '-').slice(0, descCol - 2).padEnd(descCol);
    let row = `  ${chalk.cyan(name)} ${chalk.dim(desc)}${' '.repeat(gap)}`;

    for (let i = 0; i < agents.length; i++) {
      const color = getAgentColor(agents[i]);
      const marker = skill.registeredIn.includes(agents[i])
        ? color('●')
        : chalk.dim('○');
      row += ' '.repeat(colWidths[i] - 1) + marker;
    }
    console.log(row);
  }

  // Legend with agent-colored bullets
  const legendParts: string[] = [];
  for (const agent of agents) {
    const color = getAgentColor(agent);
    const label = getAgentDisplayName(agent);
    legendParts.push(`${color('●')} ${label}`);
  }
  console.log('');
  console.log(chalk.dim(`  ${skills.length} skill${skills.length > 1 ? 's' : ''}, ${agents.length} agent${agents.length > 1 ? 's' : ''}`));
  console.log(`  ${legendParts.join('  ')}  ${chalk.dim('○ = not registered')}`);
}

export function displaySkillJson(skills: SkillInfo[], agents: AgentType[]): void {
  console.log(JSON.stringify({ skills, agents }, null, 2));
}
