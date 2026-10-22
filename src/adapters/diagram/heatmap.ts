// Transition coverage as an SVG matrix. No Graphviz: the counts come from the domain.
import type { Model } from '../../domain/model.js';
import type { TransitionCoverage } from '../../domain/verification.js';

const COLD: readonly [number, number, number] = [208, 226, 243];
const MID: readonly [number, number, number] = [246, 196, 67];
const HOT: readonly [number, number, number] = [178, 35, 24];
const FONT = 'Helvetica, Arial, sans-serif';

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hex(channels: readonly [number, number, number]): string {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mix(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

function heat(count: number, max: number): string {
  if (count <= 0 || max <= 0) return hex(COLD);
  const t = Math.min(1, count / max);
  if (t >= 1) return hex(HOT);
  if (t <= 0.5) return hex(mix(COLD, MID, t / 0.5));
  return hex(mix(MID, HOT, (t - 0.5) / 0.5));
}

function ink(count: number, max: number): string {
  if (max > 0 && count / max > 0.72) return '#ffffff';
  return '#24292f';
}

/** One cell per chart transition. Rows are source states, columns are events, color is accepted-step count. */
export function coverageHeatmapSvg(
  model: Model,
  candidate: string,
  workflowCount: number,
  coverage: readonly TransitionCoverage[],
): string {
  const events: string[] = [];
  const seenEvents = new Set<string>();
  const byKey = new Map<string, TransitionCoverage[]>();
  for (const row of coverage) {
    if (!seenEvents.has(row.event)) {
      seenEvents.add(row.event);
      events.push(row.event);
    }
    const key = `${row.from}|${row.event}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [row]);
    else list.push(row);
  }
  const states = model.states();
  const margin = 28;
  const rowHeader = 132;
  const cellW = 86;
  const cellH = 52;
  const header = 88;
  const titleBlock = 58;
  const legend = 46;
  const width = margin + rowHeader + Math.max(1, events.length) * cellW + margin;
  const height = margin + titleBlock + header + Math.max(1, states.length) * cellH + legend + margin;
  const gridTop = margin + titleBlock + header;
  const gridLeft = margin + rowHeader;
  let max = 0;
  for (const row of coverage) if (row.count > max) max = row.count;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" font-family="${FONT}">`);
  lines.push(`  <title>Transition coverage: ${xml(candidate)}</title>`);
  lines.push('  <desc>Each cell is one chart transition. The number is how many times a selected workflow accepted it. Zero is cold. A refused step is not counted.</desc>');
  lines.push('  <rect width="100%" height="100%" fill="#ffffff"/>');
  lines.push(`  <text x="${margin}" y="${margin + 22}" font-size="20" font-weight="700" fill="#24292f">Transition coverage: ${xml(candidate)}</text>`);
  const workflows = workflowCount === 1 ? '1 selected workflow' : `${workflowCount} selected workflows`;
  lines.push(`  <text x="${margin}" y="${margin + 44}" font-size="13" fill="#57606a">${xml(workflows)} · chart ${xml(model.id)} · cold is unused, hot is the most accepted</text>`);

  events.forEach((event, index) => {
    const x = gridLeft + index * cellW + cellW / 2;
    const y = gridTop - 10;
    lines.push(`  <text x="${x}" y="${y}" font-size="11" fill="#24292f" text-anchor="start" transform="rotate(-55 ${x} ${y})">${xml(event)}</text>`);
  });

  states.forEach((state, rowIndex) => {
    const y = gridTop + rowIndex * cellH;
    const mid = y + cellH / 2;
    lines.push(`  <text x="${margin}" y="${mid - 2}" font-size="13" fill="#24292f">${xml(state.label)}</text>`);
    lines.push(`  <text x="${margin}" y="${mid + 14}" font-size="10" fill="#57606a">${xml(state.id)}</text>`);
    events.forEach((event, column) => {
      const x = gridLeft + column * cellW;
      const rows = byKey.get(`${state.id}|${event}`) ?? [];
      if (rows.length === 0) {
        lines.push(`  <rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="#f6f8fa" stroke="#eaeef2"><title>no transition</title></rect>`);
        return;
      }
      const count = rows.reduce((sum, row) => sum + row.count, 0);
      const flows: string[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        for (const id of row.flows) {
          if (seen.has(id)) continue;
          seen.add(id);
          flows.push(id);
        }
      }
      const tos = rows.map((row) => row.to).join(', ');
      const who = flows.length > 0 ? ` (${flows.join(', ')})` : '';
      const tip = `${state.id} — ${event} → ${tos}: ${count}${who}`;
      const fill = heat(count, max);
      lines.push(`  <rect x="${x + 2}" y="${y + 2}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="${fill}"><title>${xml(tip)}</title></rect>`);
      lines.push(`  <text x="${x + cellW / 2}" y="${y + 22}" font-size="16" font-weight="700" fill="${ink(count, max)}" text-anchor="middle">${count}</text>`);
      lines.push(`  <text x="${x + cellW / 2}" y="${y + 38}" font-size="10" fill="${ink(count, max)}" text-anchor="middle">${xml(tos)}</text>`);
    });
  });

  const legendY = gridTop + Math.max(1, states.length) * cellH + 16;
  const legendW = Math.min(280, Math.max(120, events.length * cellW));
  lines.push('  <defs><linearGradient id="coverage-heat" x1="0" x2="1" y1="0" y2="0">');
  lines.push(`    <stop offset="0" stop-color="${hex(COLD)}"/>`);
  lines.push(`    <stop offset="0.5" stop-color="${hex(MID)}"/>`);
  lines.push(`    <stop offset="1" stop-color="${hex(HOT)}"/>`);
  lines.push('  </linearGradient></defs>');
  lines.push(`  <rect x="${gridLeft}" y="${legendY}" width="${legendW}" height="12" rx="2" fill="url(#coverage-heat)"/>`);
  lines.push(`  <text x="${gridLeft}" y="${legendY + 28}" font-size="11" fill="#57606a">0</text>`);
  lines.push(`  <text x="${gridLeft + legendW}" y="${legendY + 28}" font-size="11" fill="#57606a" text-anchor="end">${max}</text>`);
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}
