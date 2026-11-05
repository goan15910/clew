import {
  CONCEPT_FILTERS,
  expectedLineage,
  expectedMeta,
  expectedVisibleIds,
  fixture,
  FRAME_FILTERS,
  LINEAGE_ORDER,
  SEARCHES,
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

const emptyFilters = (): FixtureFilters => ({ text: '', frame: '', concept: '' });

test.describe('spec view matrix', () => {
  test.beforeEach(async ({ page }) => {
    await waitForViewerReady(page);
    const meta = expectedMeta();
    await expect(page.locator('#session-id')).toHaveValue(meta.id);
    await expect(page.locator('#session-meta')).toContainText(`${meta.sentences} sentences`);
    await expect(page.locator('#session-meta')).toContainText(`${meta.concepts} concepts`);
    await expect(page.locator('#session-meta')).toContainText(`${meta.frames} frames`);
  });

  test('concept filter values exist in the fixture', () => {
    const ids = fixture.concepts.map((concept) => concept.id);
    for (const value of CONCEPT_FILTERS.filter((id) => id !== '')) expect(ids).toContain(value);
  });

  for (const view of VIEWS) {
    for (const frame of FRAME_FILTERS) {
      test(`view=${view} frame=${frame || 'any'}`, async ({ page }) => {
        const filters = { ...emptyFilters(), frame };
        await selectView(page, view);
        await applyFilters(page, filters);
        await expectVisible(page, view, filters);
        await expect(await selectedTab(page)).toBe(view);
        await expect(await readFilterState(page)).toEqual(filters);
      });
    }
  }

  for (const view of VIEWS) {
    for (const concept of CONCEPT_FILTERS) {
      test(`view=${view} concept=${concept || 'any'}`, async ({ page }) => {
        const filters = { ...emptyFilters(), concept };
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

  // Frames and Sentences apply both selects: full frame × concept cross-product.
  for (const view of ['frames', 'sentences'] as const) {
    for (const frame of FRAME_FILTERS) {
      for (const concept of CONCEPT_FILTERS) {
        test(`${view} cross frame=${frame || 'any'} concept=${concept || 'any'}`, async ({ page }) => {
          const filters = { text: '', frame, concept };
          await selectView(page, view);
          await applyFilters(page, filters);
          await expectVisible(page, view, filters);
        });
      }
    }
  }

  // Concepts: concept × search (the filters that view actually applies).
  for (const concept of CONCEPT_FILTERS) {
    for (const text of SEARCHES) {
      test(`concepts cross concept=${concept || 'any'} search=${text || '(empty)'}`, async ({ page }) => {
        const filters = { text, frame: '', concept };
        await selectView(page, 'concepts');
        await applyFilters(page, filters);
        await expectVisible(page, 'concepts', filters);
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
      for (const id of ids) {
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
    const filters = { text: 'order', frame: 'transition', concept: 'concept:order' };
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
    await selectView(page, 'frames');
    await applyFilters(page, { text: 'zzzz-no-match', frame: 'negated', concept: 'concept:clerk' });
    expect(await visibleCardIds(page, 'frames')).toEqual([]);
    await clearFilters(page);
    expect(await readFilterState(page)).toEqual(emptyFilters());
    expect(await visibleCardIds(page, 'frames')).toEqual(expectedVisibleIds('frames', emptyFilters()));
  });

  test('lineage rows are split into resource tabs on every view', async ({ page }) => {
    const labels: Record<string, string> = {
      span: 'Spans',
      sentence: 'Sentences',
      concept: 'Concepts',
      frame: 'Frames',
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
      const layers = LINEAGE_ORDER.filter((layer) => rows.some((row) => row.layer === layer));
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
    await selectView(page, 'frames');
    await applyFilters(page, emptyFilters());
    const [first, second] = expectedVisibleIds('frames', emptyFilters());
    const a = await openLineage(page, 'frames', first!);
    const b = await openLineage(page, 'frames', second!);
    await expect(a).toHaveAttribute('open', '');
    await expect(b).toHaveAttribute('open', '');
    await closeLineage(page, 'frames', first!);
    await expect(a).not.toHaveAttribute('open');
    await expect(b).toHaveAttribute('open', '');
  });

  test('graph-backed frame lineage links concepts, when frames, transition, state, and flow', async ({ page }) => {
    await selectView(page, 'frames');
    await applyFilters(page, { text: 'fr:s1.t7', frame: '', concept: '' });
    expect(await visibleCardIds(page, 'frames')).toEqual(['fr:s1.t7']);
    const details = await openLineage(page, 'frames', 'fr:s1.t7');
    const rows = await readLineageRows(details);
    expect(rows).toEqual(expectedLineage('frames', 'fr:s1.t7'));
    expect(rows).toContainEqual({ layer: 'concept', text: 'actor → concept:manager (manager)' });
    expect(rows).toContainEqual({ layer: 'frame', text: 'fr:s1.t1 when → “When the customer submits an order”' });
    expect(rows).toContainEqual({ layer: 'frame', text: 'fr:s1.t12 when → “if the total is under 500 dollars”' });
    expect(rows).toContainEqual({ layer: 'transition', text: 'fr:s1.t7 submitted -APPROVE→ approved' });
    expect(rows).toContainEqual({ layer: 'state', text: 'approved (order)' });
    expect(rows).toContainEqual({ layer: 'flow', text: 'W1 transition fr:s1.t7' });

    await applyFilters(page, { text: 'fr:s1.t12', frame: '', concept: '' });
    const condition = await openLineage(page, 'frames', 'fr:s1.t12');
    const conditionRows = await readLineageRows(condition);
    expect(conditionRows).toContainEqual({ layer: 'frame', text: 'fr:s1.t7 when of → “the manager approves the order”' });
    expect(conditionRows.some((row) => row.layer === 'transition')).toBe(false);
  });

  test('concept filter narrows frames and sentences; URL stays on viewer.html while DOM state changes', async ({ page }) => {
    await selectView(page, 'frames');
    const before = page.url();
    await applyFilters(page, { text: '', frame: '', concept: 'concept:clerk' });
    expect(await visibleCardIds(page, 'frames')).toEqual(['fr:s2.t1']);
    await selectView(page, 'sentences');
    expect(await visibleCardIds(page, 'sentences')).toEqual(['s2']);
    await selectView(page, 'concepts');
    expect(await visibleCardIds(page, 'concepts')).toEqual(['concept:clerk']);
    expect(page.url()).toBe(before);
    expect(await selectedTab(page)).toBe('concepts');
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
  await expect(card.locator('details.lineage summary')).toBeVisible();
}
