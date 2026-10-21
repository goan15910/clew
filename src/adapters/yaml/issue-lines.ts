// Zod issue paths, printed the same way for model files, workflow files, and CLI options.

export function issueLines(issues: readonly { path: PropertyKey[]; message: string }[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    const path: string[] = [];
    for (const part of issue.path) {
      if (typeof part === 'string' || typeof part === 'number') path.push(String(part));
    }
    lines.push(path.length > 0 ? `${path.join('.')}: ${issue.message}` : issue.message);
  }
  return lines;
}
