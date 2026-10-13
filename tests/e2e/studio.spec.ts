import { expect, test } from '@playwright/test';

test('manual beta workflow is usable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Climbing Beta Studio')).toBeVisible();
  await expect(page.getByLabel('攀岩动作编辑画布')).toBeVisible();
  await expect(page.getByText('线路设置模式 · 只移动岩点')).toBeVisible();
  await expect(page.getByRole('button', { name: '开始选择起步点' })).toBeVisible();
  await page.getByRole('button', { name: '开始选择起步点' }).click();
  await expect(page.getByRole('button', { name: /正在选择起步点/ })).toBeVisible();
  await expect(page.locator('.start-hold-list button')).toHaveCount(2);
  const setupCanvas = page.getByLabel('攀岩动作编辑画布'); const setupBox = await setupCanvas.boundingBox(); expect(setupBox).toBeTruthy();
  await setupCanvas.click({ position: { x: setupBox!.width * .18, y: setupBox!.height * .80 } });
  await expect(page.locator('.start-hold-list button')).toHaveCount(1);
  await page.getByRole('button', { name: '开始演示', exact: true }).first().click();
  await expect(page.getByText('动作编排模式 · 岩点已锁定')).toBeVisible();
  await page.getByRole('button', { name: '动作' }).click();
  await expect(page.getByText('选择肢体')).toBeVisible();
  await page.getByRole('button', { name: '左手', exact: true }).click();
  await expect(page.getByText(/左手：/)).toBeVisible();
  await page.getByRole('button', { name: '＋ 姿势' }).click();
  await expect(page.locator('.step-card')).toHaveCount(4);
  await page.getByRole('button', { name: '导出' }).click();
  await expect(page.getByText('MP4 导出')).toBeVisible();
});

test('route editor can add a manual hold', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /添加岩点/ }).click();
  const canvas = page.getByLabel('攀岩动作编辑画布'); const box = await canvas.boundingBox(); expect(box).toBeTruthy();
  await canvas.click({ position: { x: box!.width * .48, y: box!.height * .28 } });
  await expect(page.getByText(/岩点 6/)).toBeVisible();
});
