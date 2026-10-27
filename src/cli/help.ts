// Short help is the command's own Commander text: usage, description, arguments, options, and subcommands.
// Long help is that same text plus one manual. The manual lives on the leaf that owns it.
// A group command does not store a manual. Its long help merges the manuals under it,
// so adding a leaf does not create a second copy.

export interface ExitCode {
  code: 0 | 1 | 2;
  meaning: string;
}

export interface CommandManual {
  examples: readonly string[];
  exitCodes: readonly ExitCode[];
  notes: readonly string[];
}

export const jsonNote =
  '--json writes one document to stdout. Errors go to stderr. Clew never prompts or reads stdin.';

export const sessionNote =
  'Spec sessions are stored outside the repo. When --session is omitted, Clew uses the only open session. See docs/agent-cli.md.';

export const specExits: readonly ExitCode[] = [
  { code: 0, meaning: 'the command left no blocking findings' },
  { code: 1, meaning: 'the document includes a blocking finding' },
  { code: 2, meaning: 'the input is unreadable, the arguments are wrong, or there is no spec session' },
];

interface CliCommand {
  name(): string;
  description(): string;
  helpInformation(): string;
  readonly commands: readonly CliCommand[];
}

const manuals = new WeakMap<object, CommandManual>();

function cliCommand(command: object): CliCommand {
  return command as CliCommand;
}

export function setManual(command: object, manual: CommandManual): void {
  const name = cliCommand(command).name();
  if (manual.examples.length === 0 || manual.exitCodes.length === 0 || manual.notes.length === 0) {
    throw new Error(`manual for ${name} needs examples, exit codes, and notes`);
  }
  if (manuals.has(command)) throw new Error(`manual already set for ${name}`);
  manuals.set(command, manual);
}

export function assertManuals(root: object): void {
  const missing: string[] = [];
  eachCommand(cliCommand(root), [], (command, path) => {
    if (command.commands.length === 0 && !manuals.has(command)) missing.push(path.join(' '));
  });
  if (missing.length > 0) {
    throw new Error(`setManual is missing for ${missing.join(', ')}. Add it beside that command.`);
  }
}

export function findCommand(root: object, path: readonly string[]): object | undefined {
  let current = cliCommand(root);
  for (const name of path) {
    const next = current.commands.find((command) => command.name() === name);
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

export function listCommands(root: object): string {
  const entries: { path: string; description: string }[] = [];
  eachCommand(cliCommand(root), [], (command, path) => {
    entries.push({ path: path.join(' '), description: command.description() });
  });
  const width = entries.reduce((max, entry) => Math.max(max, entry.path.length), 0);
  const lines = entries.map((entry) => `  ${entry.path.padEnd(width)}  ${entry.description}`);
  return `Usage: ${cliCommand(root).name()} help [command...]\n\nCommands:\n${lines.join('\n')}\n`;
}

export function fullHelp(command: object): string {
  const node = cliCommand(command);
  const manual = mergedManual(node);
  if (manual.examples.length === 0 || manual.exitCodes.length === 0 || manual.notes.length === 0) {
    throw new Error(`no manual for ${node.name()}`);
  }
  const short = node.helpInformation().replace(/\s+$/, '');
  return `${short}\n\n${formatManual(manual)}\n`;
}

function eachCommand(command: CliCommand, path: string[], visit: (command: CliCommand, path: string[]) => void): void {
  for (const child of command.commands) {
    const next = [...path, child.name()];
    visit(child, next);
    eachCommand(child, next, visit);
  }
}

function manualsUnder(command: CliCommand): CommandManual[] {
  const own = manuals.get(command);
  const nested = command.commands.flatMap((child) => manualsUnder(child));
  return own === undefined ? nested : [own, ...nested];
}

function mergedManual(command: CliCommand): CommandManual {
  const examples: string[] = [];
  const exitCodes: ExitCode[] = [];
  const notes: string[] = [];
  const seenExamples = new Set<string>();
  const seenExits = new Set<string>();
  const seenNotes = new Set<string>();
  for (const manual of manualsUnder(command)) {
    for (const example of manual.examples) {
      if (seenExamples.has(example)) continue;
      seenExamples.add(example);
      examples.push(example);
    }
    for (const exitCode of manual.exitCodes) {
      const key = `${exitCode.code} ${exitCode.meaning}`;
      if (seenExits.has(key)) continue;
      seenExits.add(key);
      exitCodes.push(exitCode);
    }
    for (const note of manual.notes) {
      if (seenNotes.has(note)) continue;
      seenNotes.add(note);
      notes.push(note);
    }
  }
  exitCodes.sort((left, right) => left.code - right.code);
  return { examples, exitCodes, notes };
}

function formatManual(manual: CommandManual): string {
  const sections = [
    section('Examples:', manual.examples),
    section('Exit codes:', manual.exitCodes.map((exitCode) => `${exitCode.code}  ${exitCode.meaning}`)),
    section('Notes:', manual.notes),
  ];
  return sections.join('\n\n');
}

function section(title: string, lines: readonly string[]): string {
  return [title, ...lines.map((line) => `  ${line}`)].join('\n');
}
