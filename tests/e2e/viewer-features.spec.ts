import {
  expectedMeta,
  expectedSpanCount,
  expectedSpanFilterGroups,
  expectedSpanFilterMatches,
  expectedSpanTabEntries,
  expectedVisibleIds,
  fixture,
  PACKAGE_VERSION,
  posLabel,
  significantSpansForSentence,
  skippedSpansForSentence,
  spanForSource,
  spansForSentence,
} from './helpers/fixture-data.js';
import { expect, test } from './helpers/fixtures.js';
import { cardById, clearFilters, openLineage, selectView, visibleCardIds, waitForViewerReady } from './helpers/viewer-page.js';
import type { Page } from '@playwright/test';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const emptyFilters = { text: '', kind: '', type: '', status: '' };

async function box(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await page.locator(selector).boundingBox();
  expect(rect, `${selector} has a layout box`).not.toBeNull();
  return rect!;
}

test.beforeEach(async ({ page }) => {
  await waitForViewerReady(page);
});

test.describe('rejected entities', () => {
  const rejected = fixture.entities.filter((entity) => entity.status === 'rejected').map((entity) => entity.id);

  test('hidden by default, shown by the toggle, hidden again by clear', async ({ page }) => {
    expect(rejected.length).toBeGreaterThan(0);
    await selectView(page, 'entities');
    const toggle = page.locator('#filter-rejected');
    await expect(toggle).not.toBeChecked();
    expect(await visibleCardIds(page, 'entities')).toEqual(expectedVisibleIds('entities', emptyFilters));
    expect(await visibleCardIds(page, 'entities')).not.toContain(rejected[0]);

    await toggle.check();
    expect(await visibleCardIds(page, 'entities')).toEqual(fixture.entities.map((entity) => entity.id));

    await clearFilters(page);
    await expect(toggle).not.toBeChecked();
    expect(await visibleCardIds(page, 'entities')).not.toContain(rejected[0]);
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
      `${meta.sentences} sentences · ${expectedSpanCount()} spans · ${meta.entities} entities · ${meta.facts} facts`,
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
  test('refresh button sits left of the banner and reloads the load time', async ({ page }) => {
    const button = await box(page, '#refresh');
    const banner = await box(page, '#banner');
    expect(button.x + button.width).toBeLessThanOrEqual(banner.x);
    await expect(page.locator('#refresh')).toHaveText('🔄');
    const before = await page.locator('#banner').textContent();
    await page.waitForTimeout(1100);
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
      await page.waitForTimeout(1100);
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
    for (const id of ['filter-text', 'filter-kind', 'filter-type', 'filter-status', 'filter-span', 'filter-clear']) {
      await expect(toolbar.locator(`#${id}`)).toHaveCount(1);
    }
    await expect(toolbar.locator('#filter-token')).toHaveCount(0);
    await expect(toolbar.locator('.tabs')).toHaveCount(0);
    await expect(page.locator('main .tabset > .tabs [role="tab"]')).toHaveCount(5);
    const toolbarBox = await box(page, '.toolbar');
    const tabsetBox = await box(page, '.tabset');
    expect(tabsetBox.y).toBeGreaterThan(toolbarBox.y + toolbarBox.height - 1);
  });

  test('every panel renders inside the shared tab body', async ({ page }) => {
    for (const view of ['facts', 'entities', 'sentences', 'spans', 'graph']) {
      await expect(page.locator(`.tabset > .tab-body > #panel-${view}`)).toHaveCount(1);
    }
  });

  test('selected tab merges with the tab body; others stay distinct', async ({ page }) => {
    for (const view of ['facts', 'entities', 'sentences', 'spans', 'graph'] as const) {
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
  test('shows the order chart and HappyPath as static images, with no lineage', async ({ page }) => {
    test.setTimeout(60_000);
    await selectView(page, 'graph');
    const panel = page.locator('#panel-graph');
    const order = panel.locator('img[alt="State chart of order"]');
    const happy = panel.locator('img[alt="HappyPath: Submit then approve"]');
    await expect(order).toBeVisible({ timeout: 20_000 });
    await expect(happy).toBeVisible({ timeout: 20_000 });
    const orderWidth = await order.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return img.naturalWidth;
    });
    const happyWidth = await happy.evaluate(async (img: HTMLImageElement) => {
      await img.decode();
      return img.naturalWidth;
    });
    expect(orderWidth).toBeGreaterThan(0);
    expect(happyWidth).toBeGreaterThan(0);
    await expect(panel.locator('details.lineage')).toHaveCount(0);
    await page.locator('#filter-text').fill('zzzz-no-match');
    await expect(order).toBeVisible();
    await expect(happy).toBeVisible();
    await expect(panel.locator('details.lineage')).toHaveCount(0);
  });
});

test.describe('span tab', () => {
  test('lists unique (surface, tags) entries grouped by main POS', async ({ page }) => {
    await selectView(page, 'spans');
    const expected = expectedSpanTabEntries();
    expect(expected.length).toBeGreaterThan(0);
    const panel = page.locator('#panel-spans');
    const keys = await panel.locator('article.card').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.entryKey),
    );
    expect(keys).toEqual(expected.map((entry) => entry.key));
    const groups = await panel.locator('h2.span-group').allTextContents();
    expect(groups).toEqual([...new Set(expected.map((entry) => entry.pos))]);
    const order = expected.find((entry) => entry.surface === 'order');
    expect(order?.count).toBeGreaterThan(1);
    await expect(panel.locator(`article.card[data-entry-key="${order!.key}"] .blurb`)).toHaveText(
      `${order!.count} occurrences`,
    );
  });

  test('hides insignificant spans by default and shows them when toggled', async ({ page }) => {
    const hidden = expectedSpanTabEntries();
    const shown = expectedSpanTabEntries({ showInsignificant: true });
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
  });

  test('paginates at 30 entries', async ({ page, viewer }) => {
    const other = join(dirname(viewer.sessionDir), 'zz-span-page');
    cpSync(viewer.sessionDir, other, { recursive: true });
    const session = JSON.parse(readFileSync(join(other, 'session.json'), 'utf8')) as { id: string };
    writeFileSync(join(other, 'session.json'), JSON.stringify({ ...session, id: 'zz-span-page' }));
    const spansDoc = JSON.parse(readFileSync(join(other, 'spans.json'), 'utf8')) as {
      schemaVersion: number;
      spans: Array<Record<string, unknown>>;
    };
    const extras = Array.from({ length: 40 }, (_, index) => ({
      id: `sp:s1.tpage${index}..s1.tpage${index}`,
      firstTokenId: `s1.t1`,
      lastTokenId: `s1.t1`,
      surface: `word${String(index).padStart(2, '0')}`,
      tags: ['Noun', 'Singular'],
      origin: 'promote',
      explicitlySet: false,
      entityLinkExplicitlySet: false,
    }));
    spansDoc.spans = [...spansDoc.spans, ...extras];
    writeFileSync(join(other, 'spans.json'), JSON.stringify(spansDoc, null, 2));
    try {
      await page.locator('#session-id').hover();
      await page.locator('#session-id').selectOption('zz-span-page');
      await expect(page).toHaveURL(/[?&]session=zz-span-page/);
      await selectView(page, 'spans');
      const panel = page.locator('#panel-spans');
      await expect(panel.locator('nav.pager').first()).toContainText('1–30 of');
      await expect(panel.locator('article.card')).toHaveCount(30);
      await panel.locator('nav.pager button[data-page="next"]').first().click();
      await expect(panel.locator('nav.pager').first()).toContainText('31–');
      const rest = await panel.locator('article.card').count();
      expect(rest).toBeGreaterThan(0);
      expect(rest).toBeLessThanOrEqual(30);
    } finally {
      rmSync(other, { recursive: true, force: true });
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
  test('entity sourced by a token maps to a span sentence row with marked surface', async ({ page }) => {
    await selectView(page, 'entities');
    const entity = fixture.entities.find((row) => (row.sources ?? []).length === 1 && /\.t\d+$/.test(row.sources![0]!))!;
    const tokenId = entity.sources![0]!;
    const sentenceId = tokenId.split('.')[0]!;
    const sentence = fixture.sentences.find((row) => row.id === sentenceId)!;
    const span = spanForSource(tokenId)!;

    const details = await openLineage(page, 'entities', entity.id);
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

  test('facts and entities ignore the span filter', async ({ page }) => {
    const value = expectedSpanFilterGroups()[0]!.options[0]!.value;
    await page.locator('#filter-span').selectOption(value);
    for (const view of ['facts', 'entities'] as const) {
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
