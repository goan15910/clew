// Use case: write one version of the session's sentences as Markdown. Does not write the session.
import { renderSentences } from '../domain/spec-sentences.js';
import { specInput, type Outcome, type SpecExportDocument } from './documents.js';
import type { SpecTextSink } from './ports.js';
import { resolveSession } from './spec-session.js';
import { resolveVersion, type VersionPorts } from './versions.js';

export interface ExportSpecCommand {
  sessionId?: string;
  /** original, latest, or a milestone id. */
  version: string;
  /** Absent means a dry run: the Markdown goes in the document's `text`. */
  out?: string;
}

export function exportSpec(command: ExportSpecCommand, ports: VersionPorts, sink: SpecTextSink): Outcome<SpecExportDocument> {
  if (command.out === '-') return invalid('Clew does not write stdout; pass a file to --out');
  const store = ports.store;
  const resolved = resolveSession(store, command.sessionId);
  if (!resolved.ok) return invalid(resolved.message);
  let rendered: { text: string; count: number };
  let session: string;
  if (command.version === 'original' || command.version === 'latest') {
    const read = store.update(resolved.id, { create: false }, () => undefined);
    if (!read.ok) return invalid(read.message, read.fault === 'missing' ? 'session' : read.fault);
    rendered = renderSentences(read.snapshot.sentences, command.version);
    session = read.snapshot.id;
  } else {
    const version = resolveVersion(ports, resolved.id, command.version);
    if (!version.ok) return invalid(version.message, version.fault === 'version' ? 'session' : version.fault);
    rendered = renderSentences(version.version.snapshot.sentences, 'latest');
    session = version.version.snapshot.id;
  }
  const document: SpecExportDocument = {
    command: 'spec.export',
    ok: true,
    session,
    version: command.version,
    sentences: rendered.count,
    findings: [],
    issues: [],
  };
  if (command.out === undefined) {
    document.text = rendered.text;
    return { exit: 'pass', document };
  }
  const written = sink.write(command.out, rendered.text);
  if (!written.ok) return invalid(written.message, 'unreadable');
  document.written = command.out;
  return { exit: 'pass', document };
}

function invalid(message: string, fault: SpecExportDocument['fault'] = 'session'): Outcome<SpecExportDocument> {
  return {
    exit: 'invalid',
    document: { command: 'spec.export', ok: false, fault, findings: [], issues: [specInput(undefined, message)] },
  };
}
