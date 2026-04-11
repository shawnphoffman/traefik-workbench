/**
 * Shared fixtures for the Playwright E2E suite.
 *
 * The server under test points at `./test-data` and `./test-templates`
 * (see `playwright.config.ts`). Tests mutate these directories in
 * place, so every test starts with `seedDataDir()` called from
 * `test.beforeEach` — that wipes the directory and writes a known-good
 * set of files.
 *
 * We avoid any HTTP coupling here: everything goes through `fs` so the
 * seed is deterministic and fast.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.cwd(), 'test-data');
export const TEMPLATES_DIR = path.resolve(process.cwd(), 'test-templates');

/** Canonical on-disk state every test can assume before it runs. */
export const SEED_FILES: Record<string, string> = {
  'routers/web.yml':
    'http:\n  routers:\n    web:\n      rule: Host(`example.com`)\n      service: web-svc\n',
  'services/web.yml':
    'http:\n  services:\n    web-svc:\n      loadBalancer:\n        servers:\n          - url: http://backend:8080\n',
};

/** Template files that the server serves from /api/templates. */
export const SEED_TEMPLATES: Record<string, string> = {
  'router.yml':
    'http:\n  routers:\n    NAME:\n      rule: Host(`EXAMPLE.COM`)\n      service: SERVICE\n',
};

/**
 * Reset the data directory to the canonical SEED state. Removes any
 * files or directories left behind by a previous test.
 */
export async function seedDataDir(): Promise<void> {
  await fs.rm(DATA_DIR, { recursive: true, force: true });
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const [relPath, content] of Object.entries(SEED_FILES)) {
    const abs = path.join(DATA_DIR, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
}

/**
 * Reset the templates directory. We run this per-test so the suite is
 * robust to any test that might create templates from the UI.
 */
export async function seedTemplatesDir(): Promise<void> {
  await fs.rm(TEMPLATES_DIR, { recursive: true, force: true });
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
  for (const [relPath, content] of Object.entries(SEED_TEMPLATES)) {
    const abs = path.join(TEMPLATES_DIR, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
}

/** Read a file from the data directory as a string. */
export async function readDataFile(relPath: string): Promise<string> {
  return fs.readFile(path.join(DATA_DIR, relPath), 'utf8');
}

/** Check whether a path exists inside the data directory. */
export async function dataPathExists(relPath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(DATA_DIR, relPath));
    return true;
  } catch {
    return false;
  }
}
