import {
  expectedLineage,
  expectedMeta,
  expectedVisibleIds,
  KINDS,
  SEARCHES,
  STATUSES,
  TYPES,
  VIEWS,
  type FixtureFilters,
  type View,
} from './helpers/fixture-data.js';
import { expect, test } from './helpers/fixtures.js';
import {
  applyFilters,
  clearFilters,
  closeLineage,
  openLineage,
  readFilterState,
  readLineageRows,
  readVisibleLineageRows,
  selectView,
  selectedTab,
  visibleCardIds,
  waitForViewerReady,
} from './helpers/viewer-page.js';

const emptyFilters = (): FixtureFilters => ({ text: '', kind: '', type: '', status: '' });

test.describe('spec view matrix', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    const meta = expectedMeta();
    await expect(page.locator('#session-id')).toHaveText(meta.id);
    await expect(page.locator('#session-meta')).toContainText(`${meta.sentences} sentences`);
    await expect(page.locator('#session-meta')).toContainText(`${meta.entities} entities`);
    await expect(page.locator('#session-meta')).toContainText(`${meta.facts} facts`);
  });

  for (const view of VIEWS) {
    for (const kind of KINDS) {
      test(`view=${view} kind=${kind || 'any'}`, async ({ page }) => {
        const filters = { ...emptyFilters(), kind };
        await selectView(page, view);
        await applyFilters(page, filters);
        await expectVisible(page, view, filters);
        await expect(await selectedTab(page)).toBe(view);
        await expect(await readFilterState(page)).toEqual(filters);
      });
    }
  }

  for (const view of VIEWS) {
    for (const type of TYPES) {
      test(`view=${view} type=${type || 'any'}`, async ({ page }) => {
        const filters = { ...emptyFilters(), type };
        await selectView(page, view);
        await applyFilters(page, filters);
        await expectVisible(page, view, filters);
      });
    }
  }

  for (const view of VIEWS) {
    for (const status of STATUSES) {
      test(`view=${view} status=${status || 'any'}`, async ({ page }) => {
        const filters = { ...emptyFilters(), status };
        await selectView(page, view);
        await applyFilters(page, filters);
        await expectVisible(page, view, filters);
      });
    }
  }

  for (const view of VIEWS) {
    for (const text of SEARCHES) {
      test(`view=${view} search=${text || '(empty)'}`, async ({ page }) => {
        const filters = { ...emptyFilters(), text };
        await selectView(page, view);
        await applyFilters(page, filters);
        await expectVisible(page, view, filters);
      });
    }
  }

  // Full facts filter cross-product (kind × type × status) with empty search.
  for (const kind of KINDS) {
    for (const type of TYPES) {
      for (const status of STATUSES) {
        test(`facts cross kind=${kind || 'any'} type=${type || 'any'} status=${status || 'any'}`, async ({ page }) => {
          const filters = { text: '', kind, type, status };
          await selectView(page, 'facts');
          await applyFilters(page, filters);
          await expectVisible(page, 'facts', filters);
        });
      }
    }
  }

  // Entities: kind × search (the filters that view actually applies).
  for (const kind of KINDS) {
    for (const text of SEARCHES) {
      test(`entities cross kind=${kind || 'any'} search=${text || '(empty)'}`, async ({ page }) => {
        const filters = { text, kind, type: '', status: '' };
        await selectView(page, 'entities');
        await applyFilters(page, filters);
        await expectVisible(page, 'entities', filters);
      });
    }
  }
});

test.describe('lineage + click behaviors', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
  });

  for (const view of VIEWS) {
    test(`lineage expand/collapse and rows match fixture on ${view}`, async ({ page }) => {
      await selectView(page, view);
      await applyFilters(page, emptyFilters());
      const ids = expectedVisibleIds(view, emptyFilters());
      expect(ids.length).toBeGreaterThan(0);
      const sample = ids.slice(0, Math.min(3, ids.length));
      for (const id of sample) {
        const details = await openLineage(page, view, id);
        await expect(details).toHaveAttribute('open', '');
        const rows = await readLineageRows(details);
        expect(rows).toEqual(expectedLineage(view, id));
        await closeLineage(page, view, id);
        await expect(details).not.toHaveAttribute('open');
      }
    });
  }

  test('tab selection updates aria and active panel; filters persist across tabs', async ({ page }) => {
    const filters = { text: 'order', kind: 'object', type: 'transition', status: 'current' };
    await applyFilters(page, filters);
    for (const view of VIEWS) {
      await selectView(page, view);
      expect(await selectedTab(page)).toBe(view);
      for (const other of VIEWS) {
        const panel = page.locator(`#panel-${other}`);
        if (other === view) {
          await expect(panel).toHaveClass(/active/);
          await expect(panel).toBeVisible();
        } else {
          await expect(panel).not.toHaveClass(/active/);
          await expect(panel).toBeHidden();
        }
      }
      expect(await readFilterState(page)).toEqual(filters);
      await expectVisible(page, view, filters);
    }
  });

  test('clear filters resets controls and restores full lists', async ({ page }) => {
    await selectView(page, 'facts');
    await applyFilters(page, { text: 'zzzz-no-match', kind: 'actor', type: 'forbidden', status: 'stale' });
    expect(await visibleCardIds(page, 'facts')).toEqual([]);
    await clearFilters(page);
    expect(await readFilterState(page)).toEqual(emptyFilters());
    expect(await visibleCardIds(page, 'facts')).toEqual(expectedVisibleIds('facts', emptyFilters()));
  });

  test('lineage rows are split into resource tabs on every view', async ({ page }) => {
    const order = ['token', 'sentence', 'entity', 'fact', 'source', 'transition', 'state', 'flow'];
    const labels: Record<string, string> = {
      token: 'Tokens',
      sentence: 'Sentences',
      entity: 'Entities',
      fact: 'Facts',
      source: 'Sources',
      transition: 'Transitions',
      state: 'States',
      flow: 'Flows',
    };
    for (const view of VIEWS) {
      await selectView(page, view);
      await applyFilters(page, emptyFilters());
      const id = expectedVisibleIds(view, emptyFilters())[0];
      expect(id).toBeTruthy();
      const details = await openLineage(page, view, id!);
      const rows = expectedLineage(view, id!);
      const layers = order.filter((layer) => rows.some((row) => row.layer === layer));
      const tabs = details.locator('button.lineage-tab');
      await expect(tabs).toHaveCount(layers.length);
      for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]!;
        const tab = tabs.nth(index);
        await expect(tab).toHaveAttribute('data-layer', layer);
        await expect(tab).toHaveText(`${labels[layer]} (${rows.filter((row) => row.layer === layer).length})`);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        const visible = await readVisibleLineageRows(details);
        expect(visible).toEqual(rows.filter((row) => row.layer === layer));
        const hiddenCount = await details.locator('.lineage-pane[hidden] .line').count();
        expect(hiddenCount).toBe(rows.length - visible.length);
      }
    }
  });

  test('selecting a card lineage summary toggles only that drawer', async ({ page }) => {
    await selectView(page, 'facts');
    await applyFilters(page, emptyFilters());
    const [first, second] = expectedVisibleIds('facts', emptyFilters());
    const a = await openLineage(page, 'facts', first);
    const b = await openLineage(page, 'facts', second);
    await expect(a).toHaveAttribute('open', '');
    await expect(b).toHaveAttribute('open', '');
    await closeLineage(page, 'facts', first);
    await expect(a).not.toHaveAttribute('open');
    await expect(b).toHaveAttribute('open', '');
  });

  test('graph-backed lineage includes transition/state/flow rows for linked facts', async ({ page }) => {
    await selectView(page, 'facts');
    await applyFilters(page, { text: 'f8', kind: '', type: '', status: '' });
    expect(await visibleCardIds(page, 'facts')).toEqual(['f8']);
    const details = await openLineage(page, 'facts', 'f8');
    const rows = await readLineageRows(details);
    expect(rows).toEqual(expectedLineage('facts', 'f8'));
    expect(rows.some((row) => row.layer === 'flow' && row.text.includes('ForbidCancel'))).toBe(true);

    await applyFilters(page, { text: 'f4', kind: '', type: '', status: '' });
    const f4 = await openLineage(page, 'facts', 'f4');
    const f4Rows = await readLineageRows(f4);
    expect(f4Rows.some((row) => row.layer === 'transition')).toBe(true);
    expect(f4Rows.some((row) => row.layer === 'state')).toBe(true);
  });

  test('removed facts never render; URL stays on viewer.html while DOM state changes', async ({ page }) => {
    await selectView(page, 'facts');
    await applyFilters(page, emptyFilters());
    const ids = await visibleCardIds(page, 'facts');
    expect(ids).not.toContain('f10');
    const before = page.url();
    await selectView(page, 'entities');
    await applyFilters(page, { text: 'customer', kind: 'actor', type: '', status: '' });
    expect(page.url()).toBe(before);
    expect(await selectedTab(page)).toBe('entities');
    expect(await visibleCardIds(page, 'entities')).toEqual(['actor:customer']);
  });
});

async function expectVisible(page: import('@playwright/test').Page, view: View, filters: FixtureFilters): Promise<void> {
  const expected = expectedVisibleIds(view, filters);
  const actual = await visibleCardIds(page, view);
  expect(actual).toEqual(expected);
  if (expected.length === 0) {
    await expect(page.locator(`#panel-${view} .empty`)).toBeVisible();
    return;
  }
  // Spot-check body content for the first visible card against fixture fields.
  const id = expected[0]!;
  const card = page.locator(`#panel-${view} article.card`).filter({
    has: page.locator('h2 .id', { hasText: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
  await expect(card.locator('h2 .id')).toHaveText(id);
  if (view === 'facts' || view === 'entities' || view === 'sentences') {
    await expect(card.locator('details.lineage summary')).toBeVisible();
  }
}
