import { SkillRegistry } from './skills/skill-registry.js';
import { ScannerRegistry } from './scanners/registry.js';

const VALID_AGENTS = ['claude', 'copilot', 'codex', 'reasonix', 'opencode', 'gemini'];

// ── Shell script generators ─────────────────────────────────────────

export function generateCompletionScript(shell: string): string {
  switch (shell) {
    case 'bash':
      return bashScript();
    case 'zsh':
      return zshScript();
    case 'fish':
      return fishScript();
    case 'powershell':
      return powershellScript();
    default:
      throw new Error(`Unknown shell: ${shell}. Valid: bash, zsh, fish, powershell`);
  }
}

function bashScript(): string {
  return `# vibe completion for bash
_vibe_completion() {
  local IFS=$'\\n'
  COMPREPLY=($(vibe __complete --line "\${COMP_LINE}" --point "\${COMP_POINT}" 2>/dev/null))
}
complete -F _vibe_completion vibe
`;
}

function zshScript(): string {
  return `#compdef vibe

_vibe_completion() {
  local completions
  completions=("\${(@f)\$(vibe __complete --line "\${BUFFER}" --point "\${CURSOR}" 2>/dev/null)}")
  if (( \${#completions} )); then
    compadd -Q -- "\${completions[@]}"
  fi
}

_vibe_completion "\$@"
`;
}

function fishScript(): string {
  return `# vibe completion for fish
function _vibe_completion
  vibe __complete --line (commandline) --point (commandline --cursor) 2>/dev/null
end
complete -c vibe -f -a '(_vibe_completion)'
`;
}

function powershellScript(): string {
  return `# vibe completion for PowerShell
Register-ArgumentCompleter -CommandName vibe -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $line = $commandAst.ToString()
  $result = vibe __complete --line $line --point $cursorPosition 2>$null
  if ($result) {
    $result | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
}
`;
}

// ── Completion result helpers ──────────────────────────────────────

function filterPrefix(items: string[], prefix: string): string[] {
  if (!prefix) return items;
  return items.filter((item) => item.startsWith(prefix));
}

// ── Main completion handler ────────────────────────────────────────

export async function handleComplete(line: string, point: number): Promise<string[]> {
  const rawText = line.slice(0, point);
  // Commander may strip trailing spaces from --line, re-add one if point is past text
  const text = point > rawText.length && !rawText.endsWith(' ') ? rawText + ' ' : rawText;
  const tokens = tokenize(text);

  // Nothing to complete
  if (tokens.length === 0) return [];
  if (tokens[0] !== 'vibe') return [];

  const words = tokens.slice(1);

  // Cursor at end: point is past text end, or text ends with space
  const atEnd = point > rawText.length || rawText.endsWith(' ');
  const partial = atEnd ? '' : (words.length > 0 ? words[words.length - 1] : '');
  const consumed = atEnd ? words : words.slice(0, -1);

  const ctx = buildContext(consumed);

  // Only complete when there's a partial word to match against (prefix-based)
  if (!partial) return [];

  // 1. Completing a flag's value (previous word was a flag)
  if (ctx.flagValueType === 'agent') {
    return filterPrefix(VALID_AGENTS, partial);
  }
  if (ctx.flagValueType !== null) {
    return [];
  }

  // 2. Completing a flag (current word starts with -)
  if (partial.startsWith('-')) {
    return filterPrefix(getFlagsForCommand(ctx.command), partial);
  }

  // 3. No command determined yet — complete top-level commands
  if (ctx.command === '') {
    return filterPrefix(allCommands(), partial);
  }

  // 4. Command has subcommands — offer them
  const subs = COMMAND_TREE[ctx.command];
  if (subs) {
    return filterPrefix(Object.keys(subs), partial);
  }

  // 5. Command has positional arguments to complete
  const sig = getCommandSignature(ctx.command);
  if (sig && ctx.argsConsumed < sig.args.length) {
    const argName = sig.args[ctx.argsConsumed];
    return filterPrefix(await getArgCompletions(argName, ctx.agentFilter), partial);
  }

  // 6. Default: offer flags for the current command
  return filterPrefix(getFlagsForCommand(ctx.command), partial);
}

async function getArgCompletions(argName: string, agentFilter: string | null): Promise<string[]> {
  if (argName === 'agent' || argName === 'agent-a' || argName === 'agent-b') {
    return VALID_AGENTS;
  }
  if (argName === 'name') {
    return discoverSkillNames();
  }
  if (argName === 'id') {
    return discoverSessionIds(agentFilter);
  }
  if (argName === 'shell') {
    return ['bash', 'zsh', 'fish', 'powershell'];
  }
  return [];
}

// ── Context detection ──────────────────────────────────────────────

interface CompletionContext {
  command: string;        // e.g., "skills register"
  argsConsumed: number;    // positional args consumed so far
  flagValueType: 'agent' | 'string' | null;  // completing value for a flag
  agentFilter: string | null;  // agent specified via -a/--agent (for session ID scoping)
}

function buildContext(words: string[]): CompletionContext {
  let command = '';
  let argsConsumed = 0;
  let flagValueType: 'agent' | 'string' | null = null;
  let agentFilter: string | null = null;

  let i = 0;
  while (i < words.length) {
    const word = words[i];

    // Check if this word is a flag that takes a value
    if (word === '-a' || word === '--agent') {
      i++;
      if (i < words.length) {
        // Value already provided, consume it and continue
        agentFilter = words[i];
        i++;
        continue;
      } else {
        // Value not yet provided — next completion should be an agent
        flagValueType = 'agent';
        break;
      }
    }

    if (word === '-t' || word === '--to' || word === '-f' || word === '--from') {
      i++;
      if (i < words.length) {
        i++;
        continue;
      } else {
        flagValueType = 'agent';
        break;
      }
    }

    if (word === '-d' || word === '--older-than-days' || word === '-s' || word === '--since' || word === '-n' || word === '--limit') {
      i++;
      if (i < words.length) {
        i++;
        continue;
      } else {
        flagValueType = 'string';
        break;
      }
    }

    // Boolean flags and unknown flags
    if (word.startsWith('-')) {
      i++;
      continue;
    }

    // Subcommand or argument
    if (command === '') {
      // Check if it's a top-level command
      if (TOP_LEVEL_COMMANDS.has(word)) {
        command = word;
        i++;
        continue;
      }
    } else {
      // Check if it's a subcommand
      const subs = COMMAND_TREE[command];
      if (subs && word in subs) {
        command = `${command} ${word}`;
        i++;
        continue;
      }
    }

    // Must be a positional argument
    argsConsumed++;
    i++;
  }

  return { command, argsConsumed, flagValueType, agentFilter };
}

// ── Command definitions ────────────────────────────────────────────

const TOP_LEVEL_COMMANDS = new Set([
  'list', 'delete', 'delete-id', 'prune', 'search', 'stats',
  'inspect', 'doctor', 'skills', 'completion',
]);

interface CommandSig {
  args: string[];
  flags: string[];
}

const COMMAND_SIGNATURES: Record<string, CommandSig> = {
  '':                          { args: [], flags: ['--version', '--help'] },
  'list':                      { args: [], flags: ['-a', '--agent', '--json', '--help'] },
  'delete':                    { args: [], flags: ['-a', '--agent', '--all', '--help'] },
  'delete-id':                 { args: ['id'], flags: ['-a', '--agent', '--help'] },
  'prune':                     { args: [], flags: ['-d', '--older-than-days', '-a', '--agent', '--dry-run', '--help'] },
  'search':                    { args: ['query'], flags: ['-a', '--agent', '-s', '--since', '-n', '--limit', '--help'] },
  'stats':                     { args: [], flags: ['--help'] },
  'inspect':                   { args: ['id'], flags: ['-a', '--agent', '--help'] },
  'doctor':                    { args: [], flags: ['--help'] },
  'skills':                    { args: [], flags: ['--json', '--help'] },
  'skills register':           { args: ['name'], flags: ['-t', '--to', '-f', '--from', '--help'] },
  'skills deregister':         { args: ['name'], flags: ['-f', '--from', '--help'] },
  'skills inspect':            { args: ['name'], flags: ['--help'] },
  'skills diff':               { args: ['name', 'agent-a', 'agent-b'], flags: ['--help'] },
  'completion':                { args: ['shell'], flags: ['--help'] },
};

const COMMAND_TREE: Record<string, Record<string, boolean>> = {
  'skills': { 'register': true, 'deregister': true, 'inspect': true, 'diff': true },
};

function getCommandSignature(command: string): CommandSig {
  return COMMAND_SIGNATURES[command] || { args: [], flags: ['--help'] };
}

function allCommands(): string[] {
  return ['list', 'delete', 'delete-id', 'prune', 'search', 'stats', 'inspect', 'doctor', 'skills', 'completion', '--help', '--version'];
}

function getFlagsForCommand(command: string): string[] {
  return getCommandSignature(command).flags;
}

// ── Dynamic value discovery ────────────────────────────────────────

let _skillNames: string[] | null = null;
let _sessionIdCache: { ids: string[]; timestamp: number } | null = null;
const SESSION_CACHE_TTL = 30_000; // 30 seconds

async function discoverSkillNames(): Promise<string[]> {
  if (_skillNames !== null) return _skillNames;
  try {
    const registry = new SkillRegistry();
    const skills = await registry.discoverAll();
    _skillNames = skills.map((s) => s.name);
  } catch {
    _skillNames = [];
  }
  return _skillNames;
}

async function discoverSessionIds(agent: string | null): Promise<string[]> {
  const now = Date.now();
  // Cache key includes agent since different filters produce different lists
  if (_sessionIdCache && (now - _sessionIdCache.timestamp) < SESSION_CACHE_TTL) {
    return _sessionIdCache.ids;
  }

  try {
    const registry = new ScannerRegistry();
    let sessions;
    if (agent) {
      sessions = await registry.discoverByAgent(agent as import('./types.js').AgentType);
    } else {
      const groups = await registry.discoverAll();
      sessions = groups.flatMap((g) => g.sessions);
    }
    const ids = sessions.map((s) => s.id);
    _sessionIdCache = { ids, timestamp: now };
    return ids;
  } catch {
    return [];
  }
}

// ── Tokenizer ──────────────────────────────────────────────────────

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = '';
  for (const ch of line) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = '';
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
