/**
 * End-to-end coverage of the Workbench core flows.
 *
 * Each test reseeds `./test-data` to a known state via
 * `fixtures.seedDataDir()` and then exercises the UI against the
 * already-running Next.js production server.
 *
 * The suite runs with `workers: 1, fullyParallel: false` (see
 * `playwright.config.ts`) so the shared on-disk state cannot race.
 */

import { test, expect, type Page } from '@playwright/test';

import {
  dataPathExists,
  seedDataDir,
  seedTemplatesDir,
} from './fixtures';

test.beforeEach(async () => {
  await seedDataDir();
  await seedTemplatesDir();
});

/**
 * Wait for the file tree to finish its initial fetch and render the
 * seed entries. We anchor on the top-level `routers` directory label
 * because the tree starts collapsed and the fixtures always include it.
 */
async function waitForTreeLoaded(page: Page) {
  await expect(
    page.getByRole('treeitem', { name: /routers/ }),
  ).toBeVisible();
}

test.describe('Workbench', () => {
  test('loads the three-pane shell and seed files', async ({ page }) => {
    await page.goto('/');
    await waitForTreeLoaded(page);

    // Files pane header
    await expect(page.getByText('Files', { exact: true })).toBeVisible();
    // Structure pane header (right-side YAML tree)
    await expect(
      page.getByText('Structure', { exact: true }),
    ).toBeVisible();
    // No file open yet → empty-state message in the editor area
    await expect(
      page.getByText(/Open a file from the left/),
    ).toBeVisible();
  });

  test('opens a file, shows a tab, and scrolls the outline', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTreeLoaded(page);

    // Expand `routers/` then click `web.yml` inside it.
    await page.getByRole('treeitem', { name: /routers/ }).click();
    await page
      .getByRole('treeitem', { name: /web\.yml/ })
      .first()
      .click();

    // Tab appears.
    await expect(
      page.getByRole('tab', { name: /web\.yml/ }),
    ).toBeVisible();

    // Status bar reads "Saved" (no modifications yet).
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // YAML outline populated — the key `http` should show up.
    await expect(
      page.getByRole('list').getByText('http').first(),
    ).toBeVisible();
  });

  test('typing in the editor flips the status bar to "Modified"', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTreeLoaded(page);

    await page.getByRole('treeitem', { name: /services/ }).click();
    await page
      .getByRole('treeitem', { name: /web\.yml/ })
      .first()
      .click();

    // Wait for Monaco to mount.
    const editor = page.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await expect(
      page.getByText('Saved', { exact: true }),
    ).toBeVisible();

    // Click into the editor and append a line. We avoid testing the
    // Cmd/Ctrl+S keybinding from Playwright — Monaco's command
    // registry is flaky to drive from outside the iframe-like editor,
    // and the save codepath is already covered by unit tests. What
    // this test proves is that the edit → dirty-state bridge from
    // Monaco's onChange through the Workbench context to the status
    // bar is wired correctly.
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' # edited');

    await expect(page.getByText('Modified', { exact: true })).toBeVisible();
  });

  test('creates a new file via the toolbar dialog', async ({ page }) => {
    await page.goto('/');
    await waitForTreeLoaded(page);

    await page.getByRole('button', { name: 'New file' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('fresh.yml');
    await dialog.getByRole('button', { name: 'Create' }).click();

    // Dialog closes and the new file shows up as a tab.
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('tab', { name: /fresh\.yml/ }),
    ).toBeVisible();

    expect(await dataPathExists('fresh.yml')).toBe(true);
  });

  test('renames a file via the pencil icon', async ({ page }) => {
    await page.goto('/');
    await waitForTreeLoaded(page);

    // Expand routers/ so web.yml is visible, then hover to reveal
    // the row's action buttons.
    await page.getByRole('treeitem', { name: /routers/ }).click();
    const row = page
      .getByRole('treeitem', { name: /web\.yml/ })
      .first();
    await row.hover();

    await page
      .getByRole('button', { name: /Rename routers\/web\.yml/ })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('textbox');
    await input.fill('edge.yml');
    await dialog.getByRole('button', { name: 'Rename' }).click();

    await expect(dialog).toBeHidden();

    expect(await dataPathExists('routers/web.yml')).toBe(false);
    expect(await dataPathExists('routers/edge.yml')).toBe(true);
  });

  test('deletes a file via the trash icon with confirmation', async ({
    page,
  }) => {
    await page.goto('/');
    await waitForTreeLoaded(page);

    await page.getByRole('treeitem', { name: /services/ }).click();
    const row = page
      .getByRole('treeitem', { name: /web\.yml/ })
      .first();
    await row.hover();

    await page
      .getByRole('button', { name: /Delete services\/web\.yml/ })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(dialog).toBeHidden();
    expect(await dataPathExists('services/web.yml')).toBe(false);
  });

  test('copies a template into the data directory', async ({ page }) => {
    await page.goto('/');
    await waitForTreeLoaded(page);

    await page
      .getByRole('button', { name: 'Open templates' })
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Select the seeded router.yml template from the left list.
    await dialog.getByRole('button', { name: /router\.yml/ }).click();

    // The destination field auto-suggests a path; override to keep the
    // test assertion stable.
    const destInput = dialog.locator('input[type="text"]');
    await destInput.fill('from-template.yml');

    await dialog.getByRole('button', { name: /Copy/ }).click();

    await expect(dialog).toBeHidden();
    expect(await dataPathExists('from-template.yml')).toBe(true);

    // The newly-copied file should auto-open as a tab.
    await expect(
      page.getByRole('tab', { name: /from-template\.yml/ }),
    ).toBeVisible();
  });
});
