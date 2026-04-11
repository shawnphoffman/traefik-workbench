import { describe, it, expect } from 'vitest';

import {
  applyPatch,
  defaultSettings,
  defaultTraefikSettings,
  parsePatch,
  parseSettings,
} from './schema';
import { maskApiKey } from './mask';

describe('parseSettings', () => {
  it('returns defaults when given an empty object', () => {
    const result = parseSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(defaultSettings());
    }
  });

  it('rejects non-objects', () => {
    expect(parseSettings([]).ok).toBe(false);
    expect(parseSettings(null).ok).toBe(false);
    expect(parseSettings('hi').ok).toBe(false);
  });

  it('round-trips a fully populated settings record', () => {
    const input = {
      schemaVersion: 1,
      ai: {
        enabled: true,
        apiKey: 'sk-ant-test-1234567890',
        model: 'claude-haiku-4-5-20251001',
        features: { completion: false, validation: true, format: false },
      },
    };
    const result = parseSettings(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ai.enabled).toBe(true);
      expect(result.value.ai.apiKey).toBe('sk-ant-test-1234567890');
      expect(result.value.ai.features.completion).toBe(false);
      expect(result.value.ai.features.validation).toBe(true);
      expect(result.value.ai.features.format).toBe(false);
    }
  });

  it('drops unknown top-level fields and unknown ai fields', () => {
    const input = {
      schemaVersion: 1,
      bogus: 'ignored',
      ai: { enabled: true, mystery: true },
    };
    const result = parseSettings(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.value as unknown as Record<string, unknown>).bogus).toBeUndefined();
      expect(result.value.ai.enabled).toBe(true);
      expect((result.value.ai as unknown as Record<string, unknown>).mystery).toBeUndefined();
    }
  });

  it('rejects an apiKey that is the wrong type', () => {
    const result = parseSettings({ ai: { apiKey: 12 } });
    expect(result.ok).toBe(false);
  });

  it('falls back to default model when an unknown one is given', () => {
    const result = parseSettings({ ai: { model: 'claude-fictional-99' } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ai.model).toBe(defaultSettings().ai.model);
    }
  });

  it('seeds default ignore patterns when tree is missing', () => {
    const result = parseSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tree.ignorePatterns).toEqual(
        defaultSettings().tree.ignorePatterns,
      );
    }
  });

  it('reads tree.ignorePatterns from disk', () => {
    const result = parseSettings({
      tree: { ignorePatterns: ['.git/', '*.log', '  ', 'node_modules/'] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Whitespace-only entries are dropped, others are trimmed.
      expect(result.value.tree.ignorePatterns).toEqual([
        '.git/',
        '*.log',
        'node_modules/',
      ]);
    }
  });
});

describe('parsePatch', () => {
  it('accepts a partial patch', () => {
    const result = parsePatch({ ai: { enabled: true } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ai?.enabled).toBe(true);
    }
  });

  it('treats null apiKey as a clear', () => {
    const result = parsePatch({ ai: { apiKey: null } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ai?.apiKey).toBeNull();
    }
  });

  it('rejects a wrong-typed enabled', () => {
    expect(parsePatch({ ai: { enabled: 'yes' } }).ok).toBe(false);
  });

  it('rejects an unknown model', () => {
    expect(parsePatch({ ai: { model: 'gpt-4' } }).ok).toBe(false);
  });

  it('accepts a tree.ignorePatterns array and trims/drops empties', () => {
    const result = parsePatch({
      tree: { ignorePatterns: ['  .git/  ', '', 'node_modules/'] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tree?.ignorePatterns).toEqual([
        '.git/',
        'node_modules/',
      ]);
    }
  });

  it('rejects non-array tree.ignorePatterns', () => {
    expect(
      parsePatch({ tree: { ignorePatterns: 'no' } }).ok,
    ).toBe(false);
  });

  it('rejects non-string entries in tree.ignorePatterns', () => {
    expect(
      parsePatch({ tree: { ignorePatterns: ['.git/', 123] } }).ok,
    ).toBe(false);
  });
});

describe('applyPatch', () => {
  it('preserves untouched fields', () => {
    const current = defaultSettings();
    current.ai.apiKey = 'sk-ant-existing-1234';
    const next = applyPatch(current, { ai: { enabled: true } });
    expect(next.ai.apiKey).toBe('sk-ant-existing-1234');
    expect(next.ai.enabled).toBe(true);
  });

  it('clears the api key when patch.apiKey is null', () => {
    const current = defaultSettings();
    current.ai.apiKey = 'sk-ant-existing-1234';
    const next = applyPatch(current, { ai: { apiKey: null } });
    expect(next.ai.apiKey).toBeNull();
  });

  it('merges feature flags rather than replacing the whole object', () => {
    const current = defaultSettings();
    current.ai.features = { completion: true, validation: true, format: true };
    const next = applyPatch(current, { ai: { features: { format: false } } });
    expect(next.ai.features).toEqual({
      completion: true,
      validation: true,
      format: false,
    });
  });

  it('replaces tree.ignorePatterns wholesale (not merge)', () => {
    const current = defaultSettings();
    current.tree.ignorePatterns = ['old/', '*.log'];
    const next = applyPatch(current, {
      tree: { ignorePatterns: ['new/'] },
    });
    expect(next.tree.ignorePatterns).toEqual(['new/']);
    // ai untouched
    expect(next.ai).toEqual(current.ai);
  });

  it('leaves tree alone when patch only touches ai', () => {
    const current = defaultSettings();
    current.tree.ignorePatterns = ['something/'];
    const next = applyPatch(current, { ai: { enabled: true } });
    expect(next.tree.ignorePatterns).toEqual(['something/']);
  });
});

describe('parseSettings traefik section', () => {
  it('seeds default traefik settings when missing', () => {
    const result = parseSettings({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.traefik).toEqual(defaultTraefikSettings());
    }
  });

  it('round-trips a basic-auth traefik config', () => {
    const result = parseSettings({
      traefik: {
        baseUrl: 'http://traefik:8080',
        auth: { kind: 'basic', username: 'admin', password: 'sekret' },
        insecureTls: true,
        pingPath: '/ping',
        timeoutMs: 1500,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.traefik.baseUrl).toBe('http://traefik:8080');
      expect(result.value.traefik.auth).toEqual({
        kind: 'basic',
        username: 'admin',
        password: 'sekret',
      });
      expect(result.value.traefik.insecureTls).toBe(true);
      expect(result.value.traefik.timeoutMs).toBe(1500);
    }
  });

  it('treats null pingPath as ping disabled', () => {
    const result = parseSettings({ traefik: { pingPath: null } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.traefik.pingPath).toBeNull();
  });

  it('clamps timeoutMs into range', () => {
    const low = parseSettings({ traefik: { timeoutMs: 1 } });
    const high = parseSettings({ traefik: { timeoutMs: 999_999 } });
    expect(low.ok && low.value.traefik.timeoutMs).toBe(250);
    expect(high.ok && high.value.traefik.timeoutMs).toBe(60_000);
  });

  it('rejects an unknown auth kind', () => {
    const result = parseSettings({
      traefik: { auth: { kind: 'oauth2', token: 'x' } },
    });
    expect(result.ok).toBe(false);
  });
});

describe('parsePatch traefik section', () => {
  it('rejects an invalid baseUrl', () => {
    const result = parsePatch({ traefik: { baseUrl: 'not a url' } });
    expect(result.ok).toBe(false);
  });

  it('accepts null baseUrl as a clear', () => {
    const result = parsePatch({ traefik: { baseUrl: null } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.traefik?.baseUrl).toBeNull();
  });

  it('accepts a partial basic auth patch (password only)', () => {
    const result = parsePatch({
      traefik: { auth: { kind: 'basic', password: 'newpw' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.traefik?.auth?.kind === 'basic') {
      expect(result.value.traefik.auth.password).toBe('newpw');
      expect(result.value.traefik.auth.username).toBeUndefined();
    }
  });
});

describe('applyPatch traefik section', () => {
  it('merges a partial basic auth patch with the existing username', () => {
    const current = defaultSettings();
    current.traefik.auth = {
      kind: 'basic',
      username: 'admin',
      password: 'old',
    };
    const next = applyPatch(current, {
      traefik: { auth: { kind: 'basic', password: 'new' } },
    });
    expect(next.traefik.auth).toEqual({
      kind: 'basic',
      username: 'admin',
      password: 'new',
    });
  });

  it('switching auth kind to none drops the password', () => {
    const current = defaultSettings();
    current.traefik.auth = {
      kind: 'basic',
      username: 'admin',
      password: 'sekret',
    };
    const next = applyPatch(current, { traefik: { auth: { kind: 'none' } } });
    expect(next.traefik.auth).toEqual({ kind: 'none' });
  });

  it('clears the password with explicit null', () => {
    const current = defaultSettings();
    current.traefik.auth = {
      kind: 'basic',
      username: 'admin',
      password: 'sekret',
    };
    const next = applyPatch(current, {
      traefik: { auth: { kind: 'basic', password: null } },
    });
    if (next.traefik.auth.kind !== 'basic') throw new Error('expected basic');
    expect(next.traefik.auth.password).toBeNull();
    expect(next.traefik.auth.username).toBe('admin');
  });

  it('leaves traefik alone when patch only touches ai', () => {
    const current = defaultSettings();
    current.traefik.baseUrl = 'http://traefik:8080';
    const next = applyPatch(current, { ai: { enabled: true } });
    expect(next.traefik.baseUrl).toBe('http://traefik:8080');
  });
});

describe('maskApiKey', () => {
  it('returns null for null/empty', () => {
    expect(maskApiKey(null)).toBeNull();
    expect(maskApiKey('')).toBeNull();
    expect(maskApiKey(undefined)).toBeNull();
  });

  it('masks short keys entirely', () => {
    expect(maskApiKey('abcd')).toBe('••••••••');
    expect(maskApiKey('abcdef12')).toBe('••••••••');
  });

  it('preserves the sk-ant- prefix and the last 4 chars of long keys', () => {
    const masked = maskApiKey('sk-ant-api03-abcdefghijklmnopWXYZ');
    expect(masked).toMatch(/^sk-ant-•+WXYZ$/);
  });
});
