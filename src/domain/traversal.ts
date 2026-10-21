// Walking a flat machine. The XState adapter implements this; the domain never imports XState.

export interface EventPath {
  state: string;
  events: readonly string[];
}

export interface Traversal {
  can(state: string, event: string): boolean;
  step(state: string, event: string): string | null;
  shortestPaths(): Readonly<Record<string, readonly string[]>>;
  pathsFromEvents(events: readonly string[]): readonly EventPath[];
}
