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

test('next-up dock follows sets and returns to the workout from another tab', async ({ page }) => {
  const dock = page.locator('#nextUp');
  await expect(dock).toBeHidden();
  await page.locator('.ex-card[data-ex="ring-pullup"] [data-act="log-set"]').first().click();
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('Pull-ups');
  await expect(dock).toContainText('Set 2 of 3');
  await expect(page.locator('#restBar')).toBeVisible();
  const restBox = await page.locator('#restBar').boundingBox();
  const dockBox = await dock.boundingBox();
  expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(restBox.y + 1);
  await page.getByRole('tab', { name: 'History' }).click();
  await dock.getByRole('button', { name: 'Go to set' }).click();
  await expect(page.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.ex-card[data-ex="ring-pullup"] .set-row').nth(1)).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('an older tab cannot erase a workout saved in another tab', async ({ page, context }) => {
  const older = await context.newPage();
  await older.goto('/');
  await page.locator('.ex-card[data-ex="ring-pullup"] [data-act="log-set"]').first().click();
  const saved = await page.evaluate(() => localStorage.getItem('workout-program:v1'));
  await older.getByRole('button', { name: 'B', exact: true }).click();
  await expect(older.locator('#storageWarning')).toBeVisible();
  expect(await older.evaluate(() => localStorage.getItem('workout-program:v1'))).toBe(saved);
  await older.reload();
  await expect(older.locator('.ex-card[data-ex="ring-pullup"] .set-row').first()).toHaveClass(/set-row--done/);
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
