import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('core workout flow persists through a reload', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bodyweight A/B');
  const pullups = page.locator('.ex-card[data-ex="ring-pullup"]');
  await pullups.locator('[data-act="log-set"]').first().click();
  await expect(pullups.locator('.set-row').first()).toHaveClass(/set-row--done/);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  await expect(page.locator('.ex-card[data-ex="ring-pullup"] .set-row').first())
    .toHaveClass(/set-row--done/);
});

test('tabs work from the keyboard', async ({ page }) => {
  const today = page.getByRole('tab', { name: 'Today' });
  await today.focus();
  await today.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'History' })).toBeVisible();
});

for (const tab of ['Today', 'History', 'Program', 'Data']) {
  test(`${tab} has no automated accessibility violations`, async ({ page }) => {
    if (tab !== 'Today') await page.getByRole('tab', { name: tab }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('installed shell reopens offline', async ({ page, context }) => {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return !!navigator.serviceWorker.controller;
  });
  await page.waitForFunction(async () => {
    const url = new URL('images/dead-hang.gif', location.href).href;
    return !!(await caches.match(url));
  });
  await page.reload();
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bodyweight A/B');
    await expect(page.getByRole('tab', { name: 'Today' })).toBeVisible();
    const deadHang = page.locator('.ex-card[data-ex="dead-hang"]');
    await deadHang.getByRole('button', { name: 'Show details for Dead hang' }).click();
    await expect(deadHang.locator('.ex-figure')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
