import {
  conceptRoles,
  expectedMeta,
  expectedSpanCount,
  expectedSpanFilterGroups,
  expectedSpanFilterMatches,
  expectedSpanTabEntries,
  expectedVisibleIds,
  fixture,
  frameIncomplete,
  frameReach,
  frameTransitions,
  frameWhen,
  PACKAGE_VERSION,
  posLabel,
  roleText,
  significantSpansForSentence,
  skippedSpansForSentence,
  spanForSource,
  spansForSentence,
} from './helpers/fixture-data.js';
import { expect, test } from './helpers/fixtures.js';
import { cardById, clearFilters, openLineage, selectView, visibleCardIds, waitForViewerReady } from './helpers/viewer-page.js';
import type { Page } from '@playwright/test';
import type { Frame } from '../../src/domain/spec.js';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const emptyFilters = { text: '', frame: '', concept: '' };

async function box(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await page.locator(selector).boundingBox();
  expect(rect, `${selector} has a layout box`).not.toBeNull();
  return rect!;
}

test.beforeEach(async ({ page }) => {
  await waitForViewerReady(page);
});

test.describe('frames tab', () => {
  test.beforeEach(async ({ page }) => {
    await selectView(page, 'frames');
  });

  for (const frame of fixture.frames) {
    test(`${frame.id} card shows clause, pills, roles, and graph citations`, async ({ page }) => {
      const card = cardById(page, 'frames', frame.id);
      await expect(card.locator('.blurb')).toHaveText(frame.clause.text);
      const pills = [frame.sentence];
      if (frame.marker) pills.push(frame.marker);
      if (frame.negated) pills.push('negated');
      if (frame.notTransition) pills.push('not a transition', frame.notTransition.reason);
      if (frameIncomplete(frame)) pills.push('incomplete');
      const reach = frameReach(frame.id);
      if (reach) pills.push(reach.status);
      await expect(card.locator('h2 .pill')).toHaveText(pills);
      await expect(card.locator('.roles dt')).toHaveText(['actor', 'event', 'object', 'result', 'when']);
      for (const role of ['actor', 'event', 'object', 'result', 'when'] as const) {
        const row = card.locator(`.roles dd[data-role="${role}"]`);
        await expect(row.locator('.role-value')).toHaveText(roleText(frame, role));
        await expect(row.locator('.role-value')).toHaveClass(roleText(frame, role) === 'unknown' ? /\bunknown\b/ : /^role-value$/);
        await expect(row.locator('.role-dep')).toHaveText(frame.roles[role].latest.dependsOn);
      }
      const transitions = frameTransitions(frame.id);
      const graph = card.locator('.frame-graph[data-graph="transition"]');
      await expect(graph).toHaveCount(transitions.length);
      for (const [index, transition] of transitions.entries()) {
        await expect(graph.nth(index)).toHaveText(`transition${transition.event}${transition.from}→${transition.to}`);
      }
    });
  }

  test('kernel reach pills show the witness or the blocking guard, through filters and lineage', async ({ page }) => {
    const reachable = fixture.frames.find((frame) => frameReach(frame.id)?.status === 'reachable')!;
    const unreachable = fixture.frames.find((frame) => frameReach(frame.id)?.status === 'unreachable')!;
    const witness = frameReach(reachable.id)!.witness!;
    const blockedBy = frameReach(unreachable.id)!.blockedBy!;
    expect(blockedBy.length).toBeGreaterThan(0);
    await page.locator('#filter-frame').selectOption('transition');
    const open = cardById(page, 'frames', reachable.id);
    await expect(open.locator('h2 .reach-pill')).toHaveAttribute('data-reach', 'reachable');
    await expect(open.locator('h2 .reach-pill .pill.ok')).toHaveText('reachable');
    await expect(open.locator('.frame-graph[data-graph="reach"]')).toHaveText(`reachable via${witness.join('→')}`);
    const closed = cardById(page, 'frames', unreachable.id);
    await expect(closed.locator('h2 .reach-pill .pill.bad')).toHaveText('unreachable');
    await expect(closed.locator('.frame-graph[data-graph="reach"] code')).toHaveText(blockedBy);
    const details = await openLineage(page, 'frames', unreachable.id);
    await expect(details.locator('.lineage-pane[data-layer="sentence"] .line-id')).toHaveText([unreachable.sentence]);
    const notTransition = fixture.frames.find((frame) => frame.notTransition !== undefined)!;
    await page.locator('#filter-frame').selectOption('not-transition');
    await expect(cardById(page, 'frames', notTransition.id).locator('.reach-pill')).toHaveCount(0);
  });

  test('the when row reads the compiled guard as one expression, ahead of the clause words it came from', async ({ page }) => {
    const guarded = fixture.frames.filter((frame) => frameWhen(frame.id) !== undefined);
    expect(guarded.some((frame) => frameWhen(frame.id)!.includes('∧'))).toBe(true);
    for (const frame of guarded) {
      const row = cardById(page, 'frames', frame.id).locator('.roles dd[data-role="when"]');
      await expect(row).toHaveClass('has-expr');
      await expect(row.locator('.when-expr')).toHaveText(frameWhen(frame.id)!);
      await expect(row.locator('.role-value')).toHaveText(roleText(frame, 'when'));
      if (roleText(frame, 'when') === 'unknown') await expect(row.locator('.role-value')).toBeHidden();
    }
    const plain = fixture.frames.find((frame) => frameWhen(frame.id) === undefined)!;
    await expect(cardById(page, 'frames', plain.id).locator('.when-expr')).toHaveCount(0);
  });

  test('a forbidden flow that cites a negated frame shows on its card and in its lineage', async ({ page, viewer }) => {
    const negated = fixture.frames.find((frame) => frame.negated === true)!;
    const other = join(dirname(viewer.sessionDir), 'zz-forbidden');
    cpSync(viewer.sessionDir, other, { recursive: true });
    const session = JSON.parse(readFileSync(join(other, 'session.json'), 'utf8')) as { id: string };
    writeFileSync(join(other, 'session.json'), JSON.stringify({ ...session, id: 'zz-forbidden' }));
    const flows = JSON.parse(readFileSync(join(other, 'flows.json'), 'utf8')) as { flows: unknown[] };
    flows.flows.push({
      id: 'W2',
      title: 'Clerk must not cancel',
      expect: 'rejected',
      rejectAt: 1,
      transitions: [],
      forbidden: negated.id,
      origin: 'rule',
    });
    writeFileSync(join(other, 'flows.json'), JSON.stringify(flows, null, 2));
    try {
      await page.locator('#session-id').hover();
      await page.locator('#session-id').selectOption('zz-forbidden');
      await expect(page).toHaveURL(/[?&]session=zz-forbidden/);
      const card = cardById(page, 'frames', negated.id);
      await expect(card.locator('.frame-graph[data-graph="forbidden"]')).toHaveText(
        `forbiddenW2${roleText(negated, 'event')}Clerk must not cancel`,
      );
      const details = await openLineage(page, 'frames', negated.id);
      await expect(details.locator('.line[data-text="W2 forbidden ' + negated.id + '"]')).toHaveCount(1);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test('a refined role shows refined, a dropped role shows dropped, and both list their history', async ({ page, viewer }) => {
    const other = join(dirname(viewer.sessionDir), 'zz-refined');
    cpSync(viewer.sessionDir, other, { recursive: true });
    const session = JSON.parse(readFileSync(join(other, 'session.json'), 'utf8')) as { id: string };
    writeFileSync(join(other, 'session.json'), JSON.stringify({ ...session, id: 'zz-refined' }));
    const target = fixture.frames.find((frame) => frame.marker === undefined && frame.negated !== true && frame.notTransition === undefined)!;
    const clerk = fixture.concepts.find((concept) => concept.id === 'concept:clerk')!;
    const actor = { value: { text: 'clerk', refs: [clerk.id] }, dependsOn: clerk.members.slice() };
    const object = target.roles.object.latest;
    const stored = JSON.parse(readFileSync(join(other, 'frames.json'), 'utf8')) as { frames: Frame[] };
    const frame = stored.frames.find((item) => item.id === target.id)!;
    frame.roles.actor.latest = actor;
    frame.roles.actor.history = [{ at: '2026-11-05T19:00:00.000Z', who: 'agent', reason: 'the clerk approves', value: actor }];
    frame.roles.object.history = [
      { at: '2026-11-05T19:00:00.000Z', who: 'agent', reason: 'object read from s2', value: { value: { text: 'package', refs: ['concept:package'] }, dependsOn: ['sp:s2.t8..s2.t8'] } },
      { at: '2026-11-05T19:01:00.000Z', who: 'clew', reason: 's2 changed', finding: `refinement-dropped:${target.id}:object`, value: { value: { text: 'package', refs: ['concept:package'] }, dependsOn: ['sp:s2.t8..s2.t8'] } },
    ];
    writeFileSync(join(other, 'frames.json'), JSON.stringify(stored, null, 2));
    const member = clerk.members[0]!;
    const concepts = JSON.parse(readFileSync(join(other, 'concepts.json'), 'utf8')) as { groups: unknown[] };
    concepts.groups.push({
      span: member,
      original: clerk.id,
      latest: clerk.id,
      dependsOn: [member],
      history: [{ at: '2026-11-05T19:00:00.000Z', who: 'agent', reason: 'kept as clerk', value: { concept: clerk.id, dependsOn: [member] } }],
    });
    writeFileSync(join(other, 'concepts.json'), JSON.stringify(concepts, null, 2));
    try {
      await page.locator('#session-id').hover();
      await page.locator('#session-id').selectOption('zz-refined');
      await expect(page).toHaveURL(/[?&]session=zz-refined/);
      const card = cardById(page, 'frames', target.id);
      const actorRow = card.locator('.roles dd[data-role="actor"]');
      await expect(actorRow.locator('.role-value')).toHaveText('clerk');
      await expect(actorRow.locator('.role-state')).toHaveAttribute('data-state', 'refined');
      await expect(actorRow.locator('.revisions li')).toHaveText(['agent the clerk approves → clerk']);
      const objectRow = card.locator('.roles dd[data-role="object"]');
      await expect(objectRow.locator('.role-value')).toHaveText(roleText(target, 'object'));
      await expect(objectRow.locator('.role-dep')).toHaveText(object.dependsOn);
      await expect(objectRow.locator('.role-state')).toHaveAttribute('data-state', 'dropped');
      await expect(objectRow.locator('.revisions li')).toHaveText(['agent object read from s2 → package', 'clew s2 changed → package']);
      await expect(card.locator('.roles dd[data-role="event"] .role-state')).toHaveCount(0);
      await selectView(page, 'concepts');
      const members = cardById(page, 'concepts', clerk.id).locator('.members .member');
      await expect(members.filter({ has: page.locator('.pill', { hasText: 'regrouped' }) })).toHaveCount(1);
      await expect(cardById(page, 'concepts', clerk.id).locator(`.member.regrouped[data-span="${member}"]`)).toHaveCount(1);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

test.describe('concepts tab', () => {
  test.beforeEach(async ({ page }) => {
    await selectView(page, 'concepts');
  });

  test('one card per concept in id order', async ({ page }) => {
    expect(await visibleCardIds(page, 'concepts')).toEqual(fixture.concepts.map((concept) => concept.id));
  });

  for (const concept of fixture.concepts) {
    test(`${concept.id} card shows canonical and member spans with their sentence`, async ({ page }) => {
      const card = cardById(page, 'concepts', concept.id);
      await expect(card.locator('.blurb')).toHaveText(concept.canonical);
      await expect(card.locator('h2 .pill')).toHaveText(
        concept.members.length === 1 ? '1 member' : `${concept.members.length} members`,
      );
      const members = card.locator('.members .member');
      expect(await members.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.span))).toEqual(concept.members);
      const spans = concept.members.map((id) => fixture.spans.find((span) => span.id === id)!);
      await expect(members.locator('.member-span')).toHaveText(spans.map((span) => span.surface));
      await expect(members.locator('.member-sentence')).toHaveText(
        spans.map((span) => span.firstTokenId.slice(0, span.firstTokenId.indexOf('.'))),
      );
    });
  }

  test('concept lineage lists the frames whose roles cite it', async ({ page }) => {
    const details = await openLineage(page, 'concepts', 'concept:order');
    const frames = fixture.frames.filter((frame) => conceptRoles(frame, 'concept:order').length > 0);
    expect(frames.length).toBeGreaterThan(1);
    await expect(details.locator('.lineage-pane[data-layer="frame"] .line .line-id')).toHaveText(frames.map((frame) => frame.id));
  });
});

test.describe('header and banner', () => {
  test('brand row shows Clew and the CLI version', async ({ page }) => {
    const brand = page.locator('header .brand');
    await expect(brand).toHaveText(`Clewv${PACKAGE_VERSION}`);
    await expect(brand.locator('.version')).toHaveText(`v${PACKAGE_VERSION}`);
    await expect(page.locator('body')).not.toContainText('__CLEW_VERSION__');
  });

  test('session id and component stats sit on separate rows below the brand', async ({ page }) => {
    const meta = expectedMeta();
    await expect(page.locator('header h1')).toHaveText(`Session ${meta.id}`);
    await expect(page.locator('#session-meta')).toHaveText(
      `${meta.sentences} sentences · ${expectedSpanCount()} spans · ${meta.concepts} concepts · ${meta.frames} frames`,
    );
    const brand = await box(page, 'header .brand');
    const title = await box(page, 'header h1');
    const stats = await box(page, '#session-meta');
    expect(title.y).toBeGreaterThanOrEqual(brand.y + brand.height - 1);
    expect(stats.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  });

  test('stats line carries counts only, not the update time', async ({ page }) => {
    const meta = page.locator('#session-meta');
    await expect(meta).not.toContainText('updated');
  });

  test('banner shows the session update time and the load time', async ({ page }) => {
    const banner = page.locator('#banner');
    const updated = await page.evaluate((iso) => new Date(iso).toLocaleString(), fixture.session.updated);
    await expect(banner).toContainText(`Session updated ${updated} · loaded `);
    await expect(banner).not.toContainText('Reload this page');
    const loaded = ((await banner.textContent()) ?? '').split(' · loaded ')[1] ?? '';
    expect(Number.isNaN(Date.parse(loaded))).toBe(false);
  });
});

test.describe('session switcher and refresh', () => {
  // Banner "loaded" uses toLocaleString() (second granularity). Advance the page
  // clock past one second so a reload/selection produces a different stamp.
  async function advancePastLoadStamp(page: Page): Promise<void> {
    await page.clock.install();
    await page.clock.fastForward(1100);
  }

  test('refresh button sits left of the banner and reloads the load time', async ({ page }) => {
    const button = await box(page, '#refresh');
    const banner = await box(page, '#banner');
    expect(button.x + button.width).toBeLessThanOrEqual(banner.x);
    await expect(page.locator('#refresh')).toHaveText('🔄');
    const before = await page.locator('#banner').textContent();
    await advancePastLoadStamp(page);
    await page.locator('#refresh').click();
    await expect(page.locator('#banner')).not.toHaveText(before ?? '');
    await expect(page.locator('#banner')).toContainText('Session updated ');
  });

  test('dropdown lists store sessions on open and selection loads that session', async ({ page, viewer }) => {
    const other = join(dirname(viewer.sessionDir), 'zz-other');
    cpSync(viewer.sessionDir, other, { recursive: true });
    const session = JSON.parse(readFileSync(join(other, 'session.json'), 'utf8')) as { id: string };
    writeFileSync(join(other, 'session.json'), JSON.stringify({ ...session, id: 'zz-other' }));
    try {
      const select = page.locator('#session-id');
      await select.hover();
      await expect(select.locator('option')).toHaveText([viewer.sessionId, 'zz-other']);
      const before = await page.locator('#banner').textContent();
      await advancePastLoadStamp(page);
      await select.selectOption('zz-other');
      await expect(page).toHaveURL(/[?&]session=zz-other/);
      await expect(select).toHaveValue('zz-other');
      await expect(page).toHaveTitle('Clew · zz-other');
      await expect(page.locator('#banner')).not.toHaveText(before ?? '');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

test.describe('toolbar and tab block', () => {
  test('toolbar holds search and filters only; tabs live in the tab block below it', async ({ page }) => {
    const toolbar = page.locator('.toolbar');
    for (const id of ['filter-text', 'filter-frame', 'filter-concept', 'filter-span', 'filter-clear']) {
      await expect(toolbar.locator(`#${id}`)).toHaveCount(1);
    }
    for (const id of ['filter-kind', 'filter-type', 'filter-status', 'filter-rejected']) {
      await expect(page.locator(`#${id}`)).toHaveCount(0);
    }
    await expect(toolbar.locator('#filter-token')).toHaveCount(0);
    await expect(toolbar.locator('.tabs')).toHaveCount(0);
    await expect(page.locator('main .tabset > .tabs [role="tab"]')).toHaveCount(5);
    const toolbarBox = await box(page, '.toolbar');
    const tabsetBox = await box(page, '.tabset');
    expect(tabsetBox.y).toBeGreaterThan(toolbarBox.y + toolbarBox.height - 1);
  });

  test('every panel renders inside the shared tab body', async ({ page }) => {
    for (const view of ['frames', 'concepts', 'sentences', 'spans', 'graph']) {
      await expect(page.locator(`.tabset > .tab-body > #panel-${view}`)).toHaveCount(1);
    }
  });

  test('selected tab merges with the tab body; others stay distinct', async ({ page }) => {
    for (const view of ['frames', 'concepts', 'sentences', 'spans', 'graph'] as const) {
      await selectView(page, view);
      const styles = await page.evaluate(() => {
        const body = getComputedStyle(document.querySelector('.tab-body')!).backgroundColor;
        return [...document.querySelectorAll<HTMLElement>('.tabs button')].map((tab) => ({
          tab: tab.dataset.tab,
          selected: tab.getAttribute('aria-selected') === 'true',
          sameAsBody: getComputedStyle(tab).backgroundColor === body,
          bottomMatchesBody: getComputedStyle(tab).borderBottomColor === body,
        }));
      });
      for (const style of styles) {
        expect(style.sameAsBody, `${style.tab} background`).toBe(style.selected);
        expect(style.bottomMatchesBody, `${style.tab} bottom edge`).toBe(style.selected);
      }
    }
  });
});

test.describe('graph tab', () => {
  test('renders interactive order chart and the W1 workflow with pan/zoom canvases', async ({ page }) => {
    test.setTimeout(60_000);
    await selectView(page, 'graph');
    const panel = page.locator('#panel-graph');
    const order = panel.locator('[data-graph-object="order"] [data-graph-mount]');
    const happy = panel.locator('[data-graph-id="W1"] [data-graph-mount]');
    await expect(order).toBeVisible({ timeout: 20_000 });
    await expect(happy).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => order.locator('.graph-cy').count()).toBeGreaterThan(0);
    await expect.poll(async () => happy.locator('.graph-cy').count()).toBeGreaterThan(0);
    const nodeCount = await order.evaluate((el) => {
      const cy = (el as HTMLElement & { __clewCy?: { nodes: () => { length: number } } }).__clewCy;
      return cy ? cy.nodes().length : 0;
    });
    expect(nodeCount).toBeGreaterThan(0);
    await expect(panel.locator('details.lineage')).toHaveCount(0);
    await page.locator('#filter-text').fill('zzzz-no-match');
    await expect(order).toBeVisible();
    await expect(happy).toBeVisible();
  });

  test('hovering a guarded transition shows condition, sentence, and lineage', async ({ page }) => {
    test.setTimeout(60_000);
    await selectView(page, 'graph');
    const panel = page.locator('#panel-graph');
    const order = panel.locator('[data-graph-object="order"]');
    await expect(order.locator('[data-graph-mount] .graph-cy')).toBeVisible({ timeout: 20_000 });
    const hovered = await order.evaluate((block) => {
      type CyCollection = { length: number; emit: (name: string) => void; data: (key: string) => unknown };
      const mount = block.querySelector('[data-graph-mount]') as HTMLElement & {
        __clewCy?: { $: (sel: string) => CyCollection };
      };
      const cy = mount?.__clewCy;
      if (!cy) return { ok: false as const, reason: 'no-cy' };
      const guarded = cy.$('edge.guarded');
      if (guarded.length === 0) return { ok: false as const, reason: 'no-guarded-edge' };
      guarded.emit('mouseover');
      return { ok: true as const, detail: guarded.data('detail') };
    });
    expect(hovered.ok, JSON.stringify(hovered)).toBe(true);
    const detail = order.locator('[data-graph-detail]');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('condition');
    await expect(detail).toContainText('the total is under 500 dollars');
    await expect(detail.locator('[data-testid="graph-hover-lineage"]')).toBeVisible();
    await expect(detail).toContainText('sentence');
    await expect(detail).toContainText('When the customer submits an order');
  });
});

type PlantedSpan = {
  id: string;
  firstTokenId: string;
  lastTokenId: string;
  surface: string;
  tags: string[];
  origin: string;
  explicitlySet: boolean;
  entityLinkExplicitlySet: boolean;
  insignificant?: boolean;
  lemma?: string;
  clause?: { text: string; start: number; end: number };
};

function multiTokenSpan(
  first: string,
  last: string,
  surface: string,
  tags: string[],
  extras: { insignificant?: boolean; lemma?: string; clause?: PlantedSpan['clause'] } = {},
): PlantedSpan {
  const span: PlantedSpan = {
    id: `sp:${first}..${last}`,
    firstTokenId: first,
    lastTokenId: last,
    surface,
    tags,
    origin: 'lexicon',
    explicitlySet: false,
    entityLinkExplicitlySet: false,
  };
  if (extras.insignificant) span.insignificant = true;
  if (extras.lemma) span.lemma = extras.lemma;
  if (extras.clause) span.clause = extras.clause;
  return span;
}

function plantSpanSession(
  viewerSessionDir: string,
  id: string,
  spans: PlantedSpan[],
): string {
  const other = join(dirname(viewerSessionDir), id);
  cpSync(viewerSessionDir, other, { recursive: true });
  const session = JSON.parse(readFileSync(join(other, 'session.json'), 'utf8')) as { id: string };
  writeFileSync(join(other, 'session.json'), JSON.stringify({ ...session, id }));
  const spansDoc = JSON.parse(readFileSync(join(other, 'spans.json'), 'utf8')) as {
    schemaVersion: number;
    spans: PlantedSpan[];
  };
  spansDoc.spans = spans;
  writeFileSync(join(other, 'spans.json'), JSON.stringify(spansDoc, null, 2));
  return other;
}

async function openPlantedSession(page: Page, id: string): Promise<void> {
  await page.locator('#session-id').hover();
  await page.locator('#session-id').selectOption(id);
  await expect(page).toHaveURL(new RegExp(`[?&]session=${id}`));
}

test.describe('span tab', () => {
  test('lists single-token spans on the default fixture until multi-token only is checked', async ({ page }) => {
    const all = expectedSpanTabEntries();
    expect(all.length).toBeGreaterThan(0);
    expect(expectedSpanTabEntries({ multiTokenOnly: true })).toEqual([]);
    await selectView(page, 'spans');
    const toggle = page.locator('#filter-multi-token');
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#panel-spans article.card').first()).toBeVisible();
    await expect(page.locator('#panel-spans .empty')).toHaveCount(0);

    await toggle.check();
    await expect(page.locator('#panel-spans .empty')).toContainText('all single-token');
    await expect(page.locator('#panel-spans .empty')).toContainText('clew spec spans merge --lexicon');
    await expect(page.locator('#panel-spans article.card')).toHaveCount(0);

    await clearFilters(page);
    await expect(toggle).not.toBeChecked();
    await expect(page.locator('#panel-spans article.card').first()).toBeVisible();
  });

  test('lists unique (surface, tags) entries grouped by main POS', async ({ page, viewer }) => {
    const spans = [
      multiTokenSpan('s1.t5', 's1.t6', 'an order', ['Noun', 'Singular']),
      multiTokenSpan('s1.t10', 's1.t11', 'an order', ['Noun', 'Singular']),
      multiTokenSpan('s1.t3', 's1.t4', 'customer submits', ['Verb', 'PresentTense']),
      multiTokenSpan('s2.t1', 's2.t2', 'must not', ['Verb', 'Negative']),
      multiTokenSpan('s1.t1', 's1.t2', 'When the', ['Conjunction']),
      // single-token span: listed by default, hidden by multi-token only
      {
        id: 'sp:s1.t7..s1.t7',
        firstTokenId: 's1.t7',
        lastTokenId: 's1.t7',
        surface: 'solo',
        tags: ['Noun', 'Singular'],
        origin: 'promote',
        explicitlySet: false,
        entityLinkExplicitlySet: false,
      },
    ];
    const dir = plantSpanSession(viewer.sessionDir, 'zz-span-multi', spans);
    try {
      await openPlantedSession(page, 'zz-span-multi');
      await selectView(page, 'spans');
      const panel = page.locator('#panel-spans');
      const cardKeys = () =>
        panel.locator('article.card').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.entryKey));
      const all = expectedSpanTabEntries({ spans });
      expect(all.map((entry) => entry.key)).toContain('solo|Noun|Singular');
      expect(await cardKeys()).toEqual(all.map((entry) => entry.key));

      await page.locator('#filter-multi-token').check();
      const expected = expectedSpanTabEntries({ spans, multiTokenOnly: true });
      expect(expected.map((entry) => entry.key)).toEqual([
        'customer submits|Verb|PresentTense',
        'must not|Verb|Negative',
        'an order|Noun|Singular',
        'When the|Conjunction',
      ]);
      const keys = await cardKeys();
      expect(keys).toEqual(expected.map((entry) => entry.key));
      expect(keys).not.toContain('solo|Noun|Singular');
      const groups = await panel.locator('h2.span-group').allTextContents();
      expect(groups).toEqual([...new Set(expected.map((entry) => entry.pos))]);
      const order = expected.find((entry) => entry.surface === 'an order')!;
      expect(order.count).toBe(2);
      await expect(panel.locator(`article.card[data-entry-key="${order.key}"] .blurb`)).toHaveText(
        '2 occurrences',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('hides insignificant multi-token spans by default and shows them when toggled', async ({
    page,
    viewer,
  }) => {
    const spans = [
      multiTokenSpan('s1.t5', 's1.t6', 'an order', ['Noun', 'Singular']),
      multiTokenSpan('s1.t2', 's1.t5', 'the customer submits an', ['Determiner'], { insignificant: true }),
      {
        id: 'sp:s1.t7..s1.t7',
        firstTokenId: 's1.t7',
        lastTokenId: 's1.t7',
        surface: 'the',
        tags: ['Determiner'],
        origin: 'promote',
        explicitlySet: false,
        entityLinkExplicitlySet: false,
        insignificant: true,
      },
    ];
    const dir = plantSpanSession(viewer.sessionDir, 'zz-span-insig', spans);
    try {
      await openPlantedSession(page, 'zz-span-insig');
      const hidden = expectedSpanTabEntries({ spans });
      const shown = expectedSpanTabEntries({ spans, showInsignificant: true });
      expect(hidden.map((entry) => entry.key)).toEqual(['an order|Noun|Singular']);
      expect(shown.length).toBeGreaterThan(hidden.length);
      await selectView(page, 'spans');
      const toggle = page.locator('#filter-insignificant');
      await expect(toggle).not.toBeChecked();
      expect(
        await page.locator('#panel-spans article.card').evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).dataset.entryKey),
        ),
      ).toEqual(hidden.map((entry) => entry.key));

      await toggle.check();
      expect(
        await page.locator('#panel-spans article.card').evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).dataset.entryKey),
        ),
      ).toEqual(shown.map((entry) => entry.key));
      await expect(page.locator('#panel-spans article.card.skipped')).toHaveCount(
        shown.filter((entry) => entry.insignificant).length,
      );

      await clearFilters(page);
      await expect(toggle).not.toBeChecked();
      expect(
        await page.locator('#panel-spans article.card').evaluateAll((els) =>
          els.map((el) => (el as HTMLElement).dataset.entryKey),
        ),
      ).toEqual(hidden.map((entry) => entry.key));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('paginates multi-token entries at 30', async ({ page, viewer }) => {
    const extras = Array.from({ length: 40 }, (_, index) =>
      multiTokenSpan(
        `s1.t${index + 1}`,
        `s1.t${index + 2}`,
        `word${String(index).padStart(2, '0')}`,
        ['Noun', 'Singular'],
      ),
    );
    const dir = plantSpanSession(viewer.sessionDir, 'zz-span-page', extras);
    try {
      await openPlantedSession(page, 'zz-span-page');
      await selectView(page, 'spans');
      const panel = page.locator('#panel-spans');
      await expect(panel.locator('nav.pager').first()).toContainText('1–30 of 40');
      await expect(panel.locator('article.card')).toHaveCount(30);
      await panel.locator('nav.pager button[data-page="next"]').first().click();
      await expect(panel.locator('nav.pager').first()).toContainText('31–40 of 40');
      await expect(panel.locator('article.card')).toHaveCount(10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('shows clause and lemma from the viewer-matrix spans', async ({ page, viewer }) => {
    const verb = fixture.spans.find((span) => span.surface === 'submits' && span.lemma)!;
    const noun = fixture.spans.find((span) => span.surface === 'order' && span.clause && !span.lemma)!;
    expect(verb.clause?.text).toBeTruthy();
    expect(noun.clause?.text).toBeTruthy();
    const spans = [
      multiTokenSpan('s1.t3', 's1.t4', 'customer submits', ['Verb', 'PresentTense'], {
        clause: verb.clause,
        lemma: verb.lemma,
      }),
      multiTokenSpan('s1.t5', 's1.t6', 'an order', ['Noun', 'Singular'], {
        clause: noun.clause,
      }),
    ];
    const dir = plantSpanSession(viewer.sessionDir, 'zz-span-clause-lemma', spans);
    try {
      await openPlantedSession(page, 'zz-span-clause-lemma');
      await selectView(page, 'spans');
      const panel = page.locator('#panel-spans');
      const verbCard = panel.locator('article.card[data-entry-key="customer submits|Verb|PresentTense"]');
      await expect(verbCard.locator('.span-clause')).toHaveText(verb.clause!.text);
      await expect(verbCard.locator('.span-lemma')).toHaveText(verb.lemma!);
      const nounCard = panel.locator('article.card[data-entry-key="an order|Noun|Singular"]');
      await expect(nounCard.locator('.span-clause')).toHaveText(noun.clause!.text);
      await expect(nounCard.locator('.span-lemma')).toHaveCount(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('sentence gloss', () => {
  test.beforeEach(async ({ page }) => {
    await selectView(page, 'sentences');
  });

  for (const sentence of fixture.sentences) {
    test(`${sentence.id} renders spans in sentence order with full POS labels`, async ({ page }) => {
      const card = cardById(page, 'sentences', sentence.id);
      const gloss = card.locator('p.gloss');
      await expect(gloss).toHaveAttribute('aria-label', sentence.text);
      const rebuilt = await gloss.evaluate((el) =>
        [...el.querySelectorAll('.gloss-word, .gloss-gap')].map((part) => part.textContent).join(''),
      );
      expect(rebuilt).toBe(sentence.text);

      const spans = spansForSentence(sentence.id);
      const words = gloss.locator('.gloss-span');
      await expect(words).toHaveCount(spans.length);
      expect(await words.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.span))).toEqual(
        spans.map((span) => span.id),
      );
      expect(await gloss.locator('.gloss-pos').allTextContents()).toEqual(
        spans.map((span) => posLabel(span.tags ?? [])),
      );
    });
  }

  test('POS label is hidden until its word is hovered', async ({ page }) => {
    const card = cardById(page, 'sentences', 's1');
    const word = card.locator('.gloss-span').nth(2);
    await expect(card.locator('.gloss-pos:visible')).toHaveCount(0);
    await word.hover();
    await expect(word.locator('.gloss-pos')).toBeVisible();
    await expect(card.locator('.gloss-pos:visible')).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(word.locator('.gloss-pos')).toBeHidden();
  });

  test('showing a POS label does not shift the sentence layout', async ({ page }) => {
    const card = cardById(page, 'sentences', 's1');
    const before = await card.locator('p.gloss').boundingBox();
    await card.locator('.gloss-span').first().hover();
    const after = await card.locator('p.gloss').boundingBox();
    expect(after).toEqual(before);
  });

  test('words carry a POS-colored underline and no visible span ids', async ({ page }) => {
    const card = cardById(page, 'sentences', 's1');
    const spans = spansForSentence('s1');
    const underline = await card.locator('.gloss-span').evaluateAll((els) =>
      els.map((el) => {
        const word = el.querySelector('.gloss-word') as HTMLElement;
        return {
          skipped: el.classList.contains('skipped'),
          width: getComputedStyle(word).borderBottomWidth,
          color: getComputedStyle(word).borderBottomColor,
        };
      }),
    );
    expect(underline.map((row) => row.skipped)).toEqual(spans.map((span) => span.insignificant === true));
    for (const [index, line] of underline.entries()) {
      if (line.skipped) expect(line.width).toBe('1px');
      else expect(line.width).toBe('3px');
    }
    const verb = spans.findIndex((span) => span.insignificant !== true && (span.tags ?? []).includes('Verb'));
    const noun = spans.findIndex((span) => span.insignificant !== true && (span.tags ?? []).includes('Noun'));
    expect(underline[verb]!.color).not.toBe(underline[noun]!.color);
    await expect(card.locator('p.gloss')).not.toContainText(/sp:s1\.t\d/);
    await expect(card.locator('.tokens, .token-id, .gloss-id, .gloss-token')).toHaveCount(0);
  });

  test('skipped stop-word spans are muted and still readable', async ({ page }) => {
    const card = cardById(page, 'sentences', 's1');
    const skipped = skippedSpansForSentence('s1');
    const significant = significantSpansForSentence('s1');
    expect(skipped.length).toBeGreaterThan(0);
    expect(significant.length).toBeGreaterThan(0);
    await expect(card.locator('.gloss-span.skipped')).toHaveCount(skipped.length);
    await expect(card.locator('.gloss-span[data-skipped="true"]')).toHaveCount(skipped.length);
    const styles = await card.locator('.gloss-span').evaluateAll((els) =>
      els.map((el) => ({
        skipped: el.classList.contains('skipped'),
        opacity: Number.parseFloat(getComputedStyle(el).opacity),
        color: getComputedStyle(el.querySelector('.gloss-word')!).color,
      })),
    );
    const skippedStyles = styles.filter((row) => row.skipped);
    const significantStyles = styles.filter((row) => !row.skipped);
    for (const row of skippedStyles) {
      expect(row.opacity).toBeLessThan(0.6);
      expect(row.color).not.toBe(significantStyles[0]!.color);
    }
    for (const row of significantStyles) expect(row.opacity).toBe(1);
    // Surfaces remain in the rebuilt sentence text.
    const rebuilt = await card.locator('p.gloss').evaluate((el) =>
      [...el.querySelectorAll('.gloss-word, .gloss-gap')].map((part) => part.textContent).join(''),
    );
    expect(rebuilt).toBe(fixture.sentences.find((sentence) => sentence.id === 's1')!.text);
  });
});

test.describe('sentence lineage', () => {
  test.beforeEach(async ({ page }) => {
    await selectView(page, 'sentences');
  });

  test('has no token lineage tab', async ({ page }) => {
    for (const sentence of fixture.sentences) {
      const details = await openLineage(page, 'sentences', sentence.id);
      await expect(details.locator('button.lineage-tab[data-layer="token"]')).toHaveCount(0);
      await expect(details.locator('.line .layer', { hasText: /^token$/ })).toHaveCount(0);
    }
  });

  test('span via refs show the surface and highlight the gloss span on hover', async ({ page }) => {
    const details = await openLineage(page, 'sentences', 's1');
    const refs = details.locator('.line-span');
    expect(await refs.count()).toBeGreaterThan(0);
    const byId = new Map(spansForSentence('s1').map((span) => [span.id, span.surface]));
    for (const ref of await refs.all()) {
      const id = (await ref.getAttribute('data-span'))!;
      await expect(ref).toHaveText(byId.get(id)!);
    }

    const ref = refs.first();
    const id = (await ref.getAttribute('data-span'))!;
    const card = cardById(page, 'sentences', 's1');
    const word = card.locator(`.gloss-span[data-span="${id}"]`);
    await expect(card.locator('.gloss-span.hit')).toHaveCount(0);
    await ref.hover();
    await expect(word).toHaveClass(/\bhit\b/);
    await expect(card.locator('.gloss-span.hit')).toHaveCount(1);
    await expect(word.locator('.gloss-pos')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(card.locator('.gloss-span.hit')).toHaveCount(0);
  });
});

test.describe('span-level lineage rows', () => {
  test('concept member span maps to a span sentence row with marked surface', async ({ page }) => {
    await selectView(page, 'concepts');
    const concept = fixture.concepts.find((row) => row.members.length === 1)!;
    const span = spanForSource(concept.members[0]!)!;
    const sentenceId = span.firstTokenId.slice(0, span.firstTokenId.indexOf('.'));
    const sentence = fixture.sentences.find((row) => row.id === sentenceId)!;

    const details = await openLineage(page, 'concepts', concept.id);
    const line = details.locator('.line').filter({ has: page.locator('.layer', { hasText: /^span$/ }) }).first();
    await expect(line.locator('.line-id')).toHaveText(span.id);
    await expect(line.locator('.line-type')).toHaveText(sentence.section);
    await expect(line.locator('.line-break')).toHaveCount(1);
    await expect(line.locator('.line-content')).toHaveText(sentence.text);
    await expect(line.locator('.source-mark')).toHaveText(span.surface);
    await expect(details.locator('.line .layer', { hasText: /^token$/ })).toHaveCount(0);
    await expect(details.locator('.line .layer', { hasText: /^sentence$/ })).toHaveCount(0);

    const id = await line.locator('.line-id').boundingBox();
    const content = await line.locator('.line-content').boundingBox();
    expect(content!.y).toBeGreaterThanOrEqual(id!.y + id!.height - 1);
  });

  test('frame dependsOn spans mark the frame evidence in its sentence', async ({ page }) => {
    await selectView(page, 'frames');
    const frame = fixture.frames.find((row) => row.id === 'fr:s1.t1')!;
    const details = await openLineage(page, 'frames', frame.id);
    const marks = await details
      .locator('.lineage-pane[data-layer="span"] .source-mark')
      .allTextContents();
    expect(marks).toEqual(['customer submits', 'order']);
  });
});

test.describe('span filter', () => {
  test('replaces the separate POS and tag selects with one grouped select', async ({ page }) => {
    await expect(page.locator('#filter-pos, #filter-tag, #filter-token')).toHaveCount(0);
    const select = page.locator('#filter-span');
    await expect(select.locator('option').first()).toHaveText('any');
    const groups = await select.evaluate((el) =>
      [...el.querySelectorAll('optgroup')].map((group) => ({
        pos: group.label,
        options: [...group.querySelectorAll('option')].map((opt) => ({ value: opt.value, text: opt.textContent })),
      })),
    );
    expect(groups).toEqual(expectedSpanFilterGroups());
  });

  test('every option value is the concatenated POS label', async ({ page }) => {
    const values = await page.locator('#filter-span optgroup option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    for (const value of values) {
      if (value.startsWith('pos:')) continue;
      expect(value).toMatch(/^[A-Z][A-Za-z]*( · [A-Z][A-Za-z]*)*$/);
    }
  });

  for (const group of expectedSpanFilterGroups()) {
    for (const option of group.options) {
      test(`"${option.text}" keeps matching sentences and marks matching spans`, async ({ page }) => {
        await selectView(page, 'sentences');
        await page.locator('#filter-span').selectOption(option.value);
        const expected = expectedSpanFilterMatches(option.value);
        expect(await visibleCardIds(page, 'sentences')).toEqual(expected.sentences);
        const marked = await page
          .locator('#panel-sentences .gloss-span.match')
          .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.span));
        expect(marked).toEqual(expected.spans);
      });
    }
  }

  test('no span is marked while the filter is any', async ({ page }) => {
    await selectView(page, 'sentences');
    await expect(page.locator('#panel-sentences .gloss-span.match')).toHaveCount(0);
    expect(await visibleCardIds(page, 'sentences')).toEqual(expectedVisibleIds('sentences', emptyFilters));
  });

  test('frames and concepts ignore the span filter', async ({ page }) => {
    const value = expectedSpanFilterGroups()[0]!.options[0]!.value;
    await page.locator('#filter-span').selectOption(value);
    for (const view of ['frames', 'concepts'] as const) {
      await selectView(page, view);
      expect(await visibleCardIds(page, view)).toEqual(expectedVisibleIds(view, emptyFilters));
    }
  });

  test('clear filters resets the span filter and restores every sentence', async ({ page }) => {
    await selectView(page, 'sentences');
    const option = expectedSpanFilterGroups().flatMap((group) => group.options)
      .find((row) => expectedSpanFilterMatches(row.value).sentences.length < fixture.sentences.length)!;
    await page.locator('#filter-span').selectOption(option.value);
    await clearFilters(page);
    await expect(page.locator('#filter-span')).toHaveValue('');
    expect(await visibleCardIds(page, 'sentences')).toEqual(expectedVisibleIds('sentences', emptyFilters));
    await expect(page.locator('#panel-sentences .gloss-span.match')).toHaveCount(0);
  });
});
