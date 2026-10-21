#!/usr/bin/env -S npx tsx
// clew: verify plain-English workflows against candidate XState machines.
//   clew verify  <machine.ts> <workflows.yaml> [--out dir] [--highlight W2]
//   clew compare <workflows.yaml> <machineA.ts> <machineB.ts> ... [--out dir] [--highlight W2]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import type { AnyStateMachine } from 'xstate';
import { ContractSchema, extractContract } from './contract.js';
import { structuralChecks, verifyWorkflow, type Workflow } from './verify.js';
import { chainMermaid, chainsDot, chartDot, chartMermaid, render, renderStacked } from './render.js';

const WorkflowFileSchema = z.strictObject({
  machineId: z.string(),
  workflows: z.array(z.strictObject({
    id: z.string(), title: z.string(), expect: z.enum(['accepted', 'rejected']),
    end: z.string().optional(), rejectAt: z.number().int().positive().optional(),
    steps: z.array(z.strictObject({ text: z.string(), event: z.string() })).min(1),
  }).refine((w) => (w.expect === 'accepted' ? !!w.end : !!w.rejectAt), 'accepted needs `end`, rejected needs `rejectAt`')),
});

async function loadMachine(file: string): Promise<AnyStateMachine> {
  const mod = await import(pathToFileURL(resolve(file)).href);
  return (mod.default?.default ?? mod.default) as AnyStateMachine;
}

async function verifyOne(machineFile: string, wfFile: string, outDir: string, highlight?: string) {
  const name = basename(machineFile).replace(/\.machine\.ts$|\.ts$/, '');
  mkdirSync(`${outDir}/chains`, { recursive: true });
  let machine: AnyStateMachine, raw: unknown;
  try { machine = await loadMachine(machineFile); raw = extractContract(machine); }
  catch (e) {
    const report = { candidate: name, schemaValid: false, schemaErrors: [`XState rejected the machine: ${(e as Error).message.split('\n').join(' ')}`] };
    mkdirSync(outDir, { recursive: true }); writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
    console.error(`[${name}] invalid machine: ${report.schemaErrors[0]}`);
    return { name, report, passed: 0, total: 0 };
  }
  // Validate once, at the outer boundary.
  const contractCheck = ContractSchema.safeParse(raw);
  if (!contractCheck.success) {
    const report = { candidate: name, schemaValid: false, schemaErrors: contractCheck.error.issues.map((i) => {
      const r = raw as any; const [k, n] = i.path as any[];
      const where = k === 'transitions' ? `${r.transitions[n].from} --${r.transitions[n].event}-->` : k === 'states' ? `state ${r.states[n].id}` : '';
      return `${i.path.join('.')}${where ? ` (${where})` : ''}: ${i.message}`;
    }) };
    writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
    console.error(`[${name}] schema invalid:\n  ` + report.schemaErrors.join('\n  '));
    return { name, report, passed: 0, total: 0 };
  }
  const contract = contractCheck.data;
  const wfs = WorkflowFileSchema.parse(parse(readFileSync(wfFile, 'utf8')));
  const structure = structuralChecks(machine, contract);
  const results = wfs.workflows.map((w) => verifyWorkflow(machine, contract, w as Workflow));
  const passed = results.filter((r) => r.pass).length;
  const usedEdges = new Set(results.flatMap((r) => r.trace.filter((t) => t.accepted).map((t) => `${t.from}|${t.event}`)));
  const unusedTransitions = contract.transitions.filter((t) => !usedEdges.has(`${t.from}|${t.event}`)).map((t) => `${t.from} --${t.event}--> ${t.to}`);
  const report = { candidate: name, machine: machineFile, schemaValid: true, contract, structure, unusedTransitions, summary: { passed, total: results.length }, workflows: results };
  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${outDir}/contract.json`, JSON.stringify(contract, null, 2));

  const md: string[] = [`# Verification report: ${name}`, '', `Machine: \`${machineFile}\`  `, `Schema: valid. Result: **${passed}/${results.length} workflows pass**.`, ''];
  md.push(`- Reachable states: ${structure.reachable.length}/${contract.states.length}` + (structure.unreachable.length ? ` (unreachable: ${structure.unreachable.join(', ')})` : ''));
  md.push(`- Dead ends (non-final, no way out): ${structure.deadEnds.length ? structure.deadEnds.join(', ') : 'none'}`);
  md.push(`- Final states: ${contract.states.filter((s) => s.final).map((s) => s.label).join(', ') || 'none'}`);
  md.push(`- Transitions not exercised by any workflow: ${unusedTransitions.length ? unusedTransitions.join('; ') : 'none'}`, '');
  md.push('| Workflow | Expect | Result | Path / reason |', '|---|---|---|---|');
  for (const r of results) {
    const path = [r.trace[0]?.from, ...r.trace.map((t) => (t.accepted ? `${t.event}→${t.to}` : `${t.event}✗`))].join(' ');
    md.push(`| ${r.id} ${r.title} | ${r.expect} | ${r.pass ? 'PASS' : '**FAIL**'} | \`${path}\`<br>${r.reason} |`);
  }
  writeFileSync(`${outDir}/report.md`, md.join('\n') + '\n');

  render(chartDot(contract, `State chart: candidate ${name}`), `${outDir}/state-chart`);
  writeFileSync(`${outDir}/state-chart.mmd`, chartMermaid(contract));
  renderStacked(contract, `Workflow proofs: candidate ${name} (${passed}/${results.length} pass)`, results, `${outDir}/workflow-chains`);
  for (const r of results) {
    render(chainsDot(contract, `${r.id}: ${r.title}`, [r]), `${outDir}/chains/${r.id}`);
    writeFileSync(`${outDir}/chains/${r.id}.mmd`, chainMermaid(contract, r));
  }
  const hl = results.find((r) => r.id === highlight);
  if (hl) render(chartDot(contract, `Overview: ${name}, path of ${hl.id} "${hl.title}" highlighted`, hl), `${outDir}/overview-${hl.id}`);

  console.log(`[${name}] ${passed}/${results.length} pass` + results.filter((r) => !r.pass).map((r) => `\n  FAIL ${r.id}: ${r.reason}`).join(''));
  return { name, report, passed, total: results.length };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f: string) => { const i = argv.indexOf(f); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const out = flag('--out') ?? 'out';
  const highlight = flag('--highlight');
  const [cmd, ...rest] = argv;
  if (cmd === 'verify' && rest.length === 2) {
    const r = await verifyOne(rest[0], rest[1], out, highlight);
    process.exit(r.passed === r.total && r.total > 0 ? 0 : 1);
  }
  if (cmd === 'compare' && rest.length >= 2) {
    const [wf, ...machines] = rest;
    const all = [];
    for (const m of machines) all.push(await verifyOne(m, wf, `${out}/${basename(m).replace(/\.machine\.ts$|\.ts$/, '')}`, highlight));
    all.sort((a, b) => b.passed - a.passed);
    const winner = all[0].passed === all[0].total ? all[0].name : null;
    const md = ['# Candidate comparison', '', '| Candidate | Passed | Failed workflows |', '|---|---|---|'];
    for (const a of all) {
      const fails = ((a.report as any).workflows ?? []).filter((r: any) => !r.pass).map((r: any) => r.id).join(', ') || 'none';
      md.push(`| ${a.name} | ${a.passed}/${a.total} | ${fails} |`);
    }
    md.push('', winner ? `**Winner: ${winner}** (passes every workflow).` : '**No candidate passes every workflow.**');
    writeFileSync(`${out}/comparison.md`, md.join('\n') + '\n');
    writeFileSync(`${out}/comparison.json`, JSON.stringify({ winner, candidates: all.map((a) => ({ name: a.name, passed: a.passed, total: a.total })) }, null, 2));
    console.log(winner ? `Winner: ${winner}` : 'No candidate passes every workflow');
    process.exit(winner ? 0 : 1);
  }
  console.error('usage:\n  clew verify <machine.ts> <workflows.yaml> [--out dir] [--highlight W2]\n  clew compare <workflows.yaml> <machine.ts>... [--out dir] [--highlight W2]');
  process.exit(2);
}
main().catch((e) => { console.error(e); process.exit(2); });
