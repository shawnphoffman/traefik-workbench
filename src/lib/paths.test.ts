import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  resolveWithinRoot,
  relativeFromRoot,
  isYamlFile,
} from './paths';

const ROOT = path.resolve(os.tmpdir(), 'traefik-workbench-test-root');

describe('resolveWithinRoot', () => {
  it('returns the root itself for an undefined path', () => {
    expect(resolveWithinRoot(ROOT, undefined)).toBe(ROOT);
  });

  it('returns the root itself for an empty string', () => {
    expect(resolveWithinRoot(ROOT, '')).toBe(ROOT);
  });

  it('returns the root itself for an empty array', () => {
    expect(resolveWithinRoot(ROOT, [])).toBe(ROOT);
  });

  it('resolves a simple filename', () => {
    expect(resolveWithinRoot(ROOT, 'web.yml')).toBe(path.join(ROOT, 'web.yml'));
  });

  it('resolves a nested path (string)', () => {
    expect(resolveWithinRoot(ROOT, 'routers/web.yml')).toBe(
      path.join(ROOT, 'routers', 'web.yml'),
    );
  });

  it('resolves a nested path (array, like Next catch-all params)', () => {
    expect(resolveWithinRoot(ROOT, ['routers', 'web.yml'])).toBe(
      path.join(ROOT, 'routers', 'web.yml'),
    );
  });

  it('rejects parent directory traversal with ..', () => {
    expect(resolveWithinRoot(ROOT, '../etc/passwd')).toBeNull();
  });

  it('rejects parent directory traversal via array segments', () => {
    expect(resolveWithinRoot(ROOT, ['..', 'etc', 'passwd'])).toBeNull();
  });

  it('rejects parent directory traversal mid-path', () => {
    expect(resolveWithinRoot(ROOT, 'routers/../../etc/passwd')).toBeNull();
  });

  it('rejects absolute-looking paths (leading slash)', () => {
    // /etc/passwd stripped to etc/passwd and resolved under ROOT — this
    // becomes ROOT/etc/passwd which is inside the root and therefore
    // returned. This is intentional: the caller cannot escape via
    // leading slashes.
    expect(resolveWithinRoot(ROOT, '/etc/passwd')).toBe(
      path.join(ROOT, 'etc', 'passwd'),
    );
  });

  it('rejects null bytes in the path', () => {
    expect(resolveWithinRoot(ROOT, 'foo\0.yml')).toBeNull();
  });

  it('rejects null bytes in array segments', () => {
    expect(resolveWithinRoot(ROOT, ['foo', 'bar\0.yml'])).toBeNull();
  });

  it('handles a path exactly at the root', () => {
    expect(resolveWithinRoot(ROOT, '.')).toBe(ROOT);
  });

  it('rejects a path that escapes then re-enters the root', () => {
    // ../<basename>/foo.yml would resolve to a sibling of the root, not
    // to the root itself.
    const escape = `../${path.basename(ROOT)}_sibling/foo.yml`;
    expect(resolveWithinRoot(ROOT, escape)).toBeNull();
  });

  it('normalizes a root that has trailing separators', () => {
    expect(resolveWithinRoot(ROOT + path.sep, 'web.yml')).toBe(
      path.join(ROOT, 'web.yml'),
    );
  });

  it('does not confuse a sibling directory that shares a prefix', () => {
    // If root is /tmp/foo, resolving against /tmp/foobar must not succeed.
    const siblingEscape = `../${path.basename(ROOT)}extra/file.yml`;
    expect(resolveWithinRoot(ROOT, siblingEscape)).toBeNull();
  });
});

describe('relativeFromRoot', () => {
  it('returns an empty string for the root itself', () => {
    expect(relativeFromRoot(ROOT, ROOT)).toBe('');
  });

  it('returns a POSIX-style relative path', () => {
    const abs = path.join(ROOT, 'routers', 'web.yml');
    expect(relativeFromRoot(ROOT, abs)).toBe('routers/web.yml');
  });
});

describe('isYamlFile', () => {
  it.each([
    ['web.yml', true],
    ['web.yaml', true],
    ['WEB.YML', true],
    ['web.json', false],
    ['web', false],
    ['.yml', true],
  ])('%s → %s', (name, expected) => {
    expect(isYamlFile(name)).toBe(expected);
  });
});
