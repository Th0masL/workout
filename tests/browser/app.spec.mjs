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

test('theme choices persist and update the browser theme color', async ({ page }) => {
  await page.getByRole('tab', { name: 'Data' }).click();
  const theme = page.getByLabel('Appearance');
  await expect(theme).toHaveValue('system');

  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f1320');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('tab', { name: 'Data' }).click();
  await page.getByLabel('Appearance').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f8fb');
});

test('System follows operating-system theme changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0f1320');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f8fb');
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
