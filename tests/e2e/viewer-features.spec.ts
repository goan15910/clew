import {
  expectedMeta,
  expectedTokenCount,
  expectedTokenFilterGroups,
  expectedTokenFilterMatches,
  expectedVisibleIds,
  fixture,
  PACKAGE_VERSION,
  posLabel,
  taggedTokens,
} from './helpers/fixture-data.js';
import { expect, test } from './helpers/fixtures.js';
import { cardById, clearFilters, openLineage, selectView, visibleCardIds, waitForViewerReady } from './helpers/viewer-page.js';
import type { Page } from '@playwright/test';

const emptyFilters = { text: '', kind: '', type: '', status: '' };

async function box(page: Page, selector: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const rect = await page.locator(selector).boundingBox();
  expect(rect, `${selector} has a layout box`).not.toBeNull();
  return rect!;
}

test.beforeEach(async ({ page }) => {
  await waitForViewerReady(page);
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
      `${meta.sentences} sentences · ${expectedTokenCount()} tokens · ${meta.entities} entities · ${meta.facts} facts`,
    );
    const brand = await box(page, 'header .brand');
    const title = await box(page, 'header h1');
    const stats = await box(page, '#session-meta');
    expect(title.y).toBeGreaterThanOrEqual(brand.y + brand.height - 1);
    expect(stats.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  });

  test('stats line carries counts only, not the spec path or update time', async ({ page }) => {
    const meta = page.locator('#session-meta');
    await expect(meta).not.toContainText(fixture.session.specPath);
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

test.describe('toolbar and tab block', () => {
  test('toolbar holds search and filters only; tabs live in the tab block below it', async ({ page }) => {
    const toolbar = page.locator('.toolbar');
    for (const id of ['filter-text', 'filter-kind', 'filter-type', 'filter-status', 'filter-token', 'filter-clear']) {
      await expect(toolbar.locator(`#${id}`)).toHaveCount(1);
    }
    await expect(toolbar.locator('.tabs')).toHaveCount(0);
    await expect(page.locator('main .tabset > .tabs [role="tab"]')).toHaveCount(3);
    const toolbarBox = await box(page, '.toolbar');
    const tabsetBox = await box(page, '.tabset');
    expect(tabsetBox.y).toBeGreaterThan(toolbarBox.y + toolbarBox.height - 1);
  });

  test('every panel renders inside the shared tab body', async ({ page }) => {
    for (const view of ['facts', 'entities', 'sentences']) {
      await expect(page.locator(`.tabset > .tab-body > #panel-${view}`)).toHaveCount(1);
    }
  });

  test('selected tab merges with the tab body; others stay distinct', async ({ page }) => {
    for (const view of ['facts', 'entities', 'sentences'] as const) {
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

test.describe('sentence gloss', () => {
  test.beforeEach(async ({ page }) => {
    await selectView(page, 'sentences');
  });

  for (const sentence of fixture.sentences) {
    test(`${sentence.id} renders words in sentence order with full POS labels`, async ({ page }) => {
      const card = cardById(page, 'sentences', sentence.id);
      const gloss = card.locator('p.gloss');
      await expect(gloss).toHaveAttribute('aria-label', sentence.text);
      const rebuilt = await gloss.evaluate((el) =>
        [...el.querySelectorAll('.gloss-word, .gloss-gap')].map((part) => part.textContent).join(''),
      );
      expect(rebuilt).toBe(sentence.text);

      const tokens = taggedTokens(sentence.id);
      const words = gloss.locator('.gloss-token');
      await expect(words).toHaveCount(tokens.length);
      expect(await words.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.token))).toEqual(
        tokens.map((token) => token.id),
      );
      expect(await gloss.locator('.gloss-pos').allTextContents()).toEqual(
        tokens.map((token) => posLabel(token.tags ?? [])),
      );
    });
  }

  test('POS label is hidden until its word is hovered', async ({ page }) => {
    const card = cardById(page, 'sentences', 's1');
    const word = card.locator('.gloss-token').nth(2);
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
    await card.locator('.gloss-token').first().hover();
    const after = await card.locator('p.gloss').boundingBox();
    expect(after).toEqual(before);
  });

  test('words carry a POS-colored underline and no visible token ids', async ({ page }) => {
    const card = cardById(page, 'sentences', 's1');
    const underline = await card.locator('.gloss-word').evaluateAll((els) =>
      els.map((el) => ({ width: getComputedStyle(el).borderBottomWidth, color: getComputedStyle(el).borderBottomColor })),
    );
    for (const line of underline) expect(line.width).toBe('3px');
    const tokens = taggedTokens('s1');
    const verb = tokens.findIndex((token) => (token.tags ?? []).includes('Verb'));
    const noun = tokens.findIndex((token) => (token.tags ?? []).includes('Noun'));
    expect(underline[verb]!.color).not.toBe(underline[noun]!.color);
    await expect(card.locator('p.gloss')).not.toContainText(/s1\.t\d/);
    await expect(card.locator('.tokens, .token-id, .gloss-id')).toHaveCount(0);
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

  test('token refs show the token text and highlight the word on hover', async ({ page }) => {
    const details = await openLineage(page, 'sentences', 's1');
    const refs = details.locator('.line-token');
    expect(await refs.count()).toBeGreaterThan(0);
    const byId = new Map(taggedTokens('s1').map((token) => [token.id, token.text]));
    for (const ref of await refs.all()) {
      const id = (await ref.getAttribute('data-token'))!;
      await expect(ref).toHaveText(byId.get(id)!);
    }

    const ref = refs.first();
    const id = (await ref.getAttribute('data-token'))!;
    const card = cardById(page, 'sentences', 's1');
    const word = card.locator(`.gloss-token[data-token="${id}"]`);
    await expect(card.locator('.gloss-token.hit')).toHaveCount(0);
    await ref.hover();
    await expect(word).toHaveClass(/\bhit\b/);
    await expect(card.locator('.gloss-token.hit')).toHaveCount(1);
    await expect(word.locator('.gloss-pos')).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(card.locator('.gloss-token.hit')).toHaveCount(0);
  });
});

test.describe('token-level lineage rows', () => {
  test('entity sourced by a token shows id and section on top, marked sentence below', async ({ page }) => {
    await selectView(page, 'entities');
    const entity = fixture.entities.find((row) => (row.sources ?? []).length === 1 && /\.t\d+$/.test(row.sources![0]!))!;
    const tokenId = entity.sources![0]!;
    const sentenceId = tokenId.split('.')[0]!;
    const sentence = fixture.sentences.find((row) => row.id === sentenceId)!;
    const token = taggedTokens(sentenceId).find((row) => row.id === tokenId)!;

    const details = await openLineage(page, 'entities', entity.id);
    const line = details.locator('.line').filter({ has: page.locator('.layer', { hasText: /^token$/ }) }).first();
    await expect(line.locator('.line-id')).toHaveText(tokenId);
    await expect(line.locator('.line-type')).toHaveText(sentence.section);
    await expect(line.locator('.line-break')).toHaveCount(1);
    await expect(line.locator('.line-content')).toHaveText(sentence.text);
    await expect(line.locator('.source-mark')).toHaveText(token.text);
    await expect(details.locator('.line .layer', { hasText: /^sentence$/ })).toHaveCount(0);

    const id = await line.locator('.line-id').boundingBox();
    const content = await line.locator('.line-content').boundingBox();
    expect(content!.y).toBeGreaterThanOrEqual(id!.y + id!.height - 1);
  });
});

test.describe('token filter', () => {
  test('replaces the separate POS and tag selects with one grouped select', async ({ page }) => {
    await expect(page.locator('#filter-pos, #filter-tag')).toHaveCount(0);
    const select = page.locator('#filter-token');
    await expect(select.locator('option').first()).toHaveText('any');
    const groups = await select.evaluate((el) =>
      [...el.querySelectorAll('optgroup')].map((group) => ({
        pos: group.label,
        options: [...group.querySelectorAll('option')].map((opt) => ({ value: opt.value, text: opt.textContent })),
      })),
    );
    expect(groups).toEqual(expectedTokenFilterGroups());
  });

  test('every option value is the concatenated POS label', async ({ page }) => {
    const values = await page.locator('#filter-token optgroup option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    for (const value of values) {
      if (value.startsWith('pos:')) continue;
      expect(value).toMatch(/^[A-Z][A-Za-z]*( · [A-Z][A-Za-z]*)*$/);
    }
  });

  for (const group of expectedTokenFilterGroups()) {
    for (const option of group.options) {
      test(`"${option.text}" keeps matching sentences and marks matching words`, async ({ page }) => {
        await selectView(page, 'sentences');
        await page.locator('#filter-token').selectOption(option.value);
        const expected = expectedTokenFilterMatches(option.value);
        expect(await visibleCardIds(page, 'sentences')).toEqual(expected.sentences);
        const marked = await page
          .locator('#panel-sentences .gloss-token.match')
          .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.token));
        expect(marked).toEqual(expected.tokens);
      });
    }
  }

  test('no word is marked while the filter is any', async ({ page }) => {
    await selectView(page, 'sentences');
    await expect(page.locator('#panel-sentences .gloss-token.match')).toHaveCount(0);
    expect(await visibleCardIds(page, 'sentences')).toEqual(expectedVisibleIds('sentences', emptyFilters));
  });

  test('facts and entities ignore the token filter', async ({ page }) => {
    const value = expectedTokenFilterGroups()[0]!.options[0]!.value;
    await page.locator('#filter-token').selectOption(value);
    for (const view of ['facts', 'entities'] as const) {
      await selectView(page, view);
      expect(await visibleCardIds(page, view)).toEqual(expectedVisibleIds(view, emptyFilters));
    }
  });

  test('clear filters resets the token filter and restores every sentence', async ({ page }) => {
    await selectView(page, 'sentences');
    const option = expectedTokenFilterGroups().flatMap((group) => group.options)
      .find((row) => expectedTokenFilterMatches(row.value).sentences.length < fixture.sentences.length)!;
    await page.locator('#filter-token').selectOption(option.value);
    await clearFilters(page);
    await expect(page.locator('#filter-token')).toHaveValue('');
    expect(await visibleCardIds(page, 'sentences')).toEqual(expectedVisibleIds('sentences', emptyFilters));
    await expect(page.locator('#panel-sentences .gloss-token.match')).toHaveCount(0);
  });
});
