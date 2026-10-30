import { expect, type Locator, type Page } from '@playwright/test';
import type { FixtureFilters, View } from './fixture-data.js';

export async function waitForViewerReady(page: Page): Promise<void> {
  await page.goto('/viewer.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#session-id')).not.toHaveValue('…');
  const banner = page.locator('#banner');
  await expect(banner).not.toHaveClass(/error/);
}

export async function selectView(page: Page, view: View | 'graph'): Promise<void> {
  await page.locator(`.tabs button[data-tab="${view}"]`).click();
  await expect(page.locator(`#panel-${view}`)).toHaveClass(/active/);
  await expect(page.locator(`#panel-${view}`)).toBeVisible();
}

export async function applyFilters(page: Page, filters: FixtureFilters): Promise<void> {
  await page.locator('#filter-text').fill(filters.text);
  await page.locator('#filter-kind').selectOption(filters.kind);
  await page.locator('#filter-type').selectOption(filters.type);
  await page.locator('#filter-status').selectOption(filters.status);
  await expect.poll(async () => readFilterState(page)).toEqual(filters);
}

export async function clearFilters(page: Page): Promise<void> {
  await page.locator('#filter-clear').click();
}

export async function readFilterState(page: Page): Promise<FixtureFilters> {
  return {
    text: await page.locator('#filter-text').inputValue(),
    kind: await page.locator('#filter-kind').inputValue(),
    type: await page.locator('#filter-type').inputValue(),
    status: await page.locator('#filter-status').inputValue(),
  };
}

export function activePanel(page: Page, view: View): Locator {
  return page.locator(`#panel-${view}.active`);
}

export async function visibleCardIds(page: Page, view: View): Promise<string[]> {
  const panel = activePanel(page, view);
  if (await panel.locator('.empty').count()) return [];
  return panel.locator('article.card h2 .id').allTextContents();
}

export function cardById(page: Page, view: View, id: string): Locator {
  // Match the card title id only — lineage bodies also mention related ids.
  return activePanel(page, view).locator('article.card').filter({
    has: page.locator('h2 > span.id', { hasText: new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }),
  });
}

export async function openLineage(page: Page, view: View, id: string): Promise<Locator> {
  const card = cardById(page, view, id);
  await expect(card).toHaveCount(1);
  const details = card.locator('details.lineage');
  const summary = details.locator('summary');
  // Blur filter inputs first — a focused search box can swallow the first click.
  await page.locator('#filter-text').evaluate((el) => (el as HTMLInputElement).blur());
  await expect.poll(async () => {
    if (await details.evaluate((el) => (el as HTMLDetailsElement).open)) return true;
    await summary.click();
    return details.evaluate((el) => (el as HTMLDetailsElement).open);
  }).toBe(true);
  return details;
}

export async function closeLineage(page: Page, view: View, id: string): Promise<void> {
  const details = cardById(page, view, id).locator('details.lineage');
  const summary = details.locator('summary');
  await page.locator('#filter-text').evaluate((el) => (el as HTMLInputElement).blur());
  await expect.poll(async () => {
    if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) return true;
    await summary.click();
    return !(await details.evaluate((el) => (el as HTMLDetailsElement).open));
  }).toBe(true);
}

async function rowsFromLines(lines: Locator): Promise<Array<{ layer: string; text: string }>> {
  const count = await lines.count();
  const rows: Array<{ layer: string; text: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const line = lines.nth(i);
    const layer = ((await line.locator('.layer').textContent()) ?? '').trim();
    const dataText = await line.getAttribute('data-text');
    if (dataText !== null) {
      rows.push({ layer, text: dataText });
      continue;
    }
    const full = ((await line.textContent()) ?? '').trim();
    const text = full.startsWith(layer) ? full.slice(layer.length).trim() : full;
    rows.push({ layer, text });
  }
  return rows;
}

export async function readLineageRows(details: Locator): Promise<Array<{ layer: string; text: string }>> {
  const empty = details.locator('.line', { hasText: 'No lineage links.' });
  if (await empty.count()) return [];
  return rowsFromLines(details.locator('.lineage-body .line'));
}

export async function readVisibleLineageRows(details: Locator): Promise<Array<{ layer: string; text: string }>> {
  return rowsFromLines(details.locator('.lineage-pane:not([hidden]) .line'));
}

export async function selectedTab(page: Page): Promise<string> {
  return (await page.locator('.tabs button[aria-selected="true"]').getAttribute('data-tab')) ?? '';
}
