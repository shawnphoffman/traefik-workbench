import { describe, it, expect } from 'vitest';

import { classifyTraefikFile, typesCompatible } from './classify';

describe('classifyTraefikFile', () => {
  it('classifies a static config by entryPoints', () => {
    const src = [
      'entryPoints:',
      '  web:',
      '    address: ":80"',
      'providers:',
      '  file:',
      '    directory: /etc/traefik',
      '',
    ].join('\n');
    expect(classifyTraefikFile(src)).toBe('static');
  });

  it('classifies a dynamic config by http', () => {
    const src = [
      'http:',
      '  routers:',
      '    web:',
      '      rule: "Host(`example.com`)"',
      '      service: api',
      '',
    ].join('\n');
    expect(classifyTraefikFile(src)).toBe('dynamic');
  });

  it('returns unknown for an empty file', () => {
    expect(classifyTraefikFile('')).toBe('unknown');
  });

  it('returns unknown for a mixed file (both static and dynamic keys)', () => {
    const src = ['entryPoints:', '  web: {}', 'http:', '  routers: {}', ''].join('\n');
    expect(classifyTraefikFile(src)).toBe('unknown');
  });

  it('returns unknown for a file with only unrelated keys', () => {
    const src = ['version: "3.8"', 'services:', '  web: {}', ''].join('\n');
    expect(classifyTraefikFile(src)).toBe('unknown');
  });

  it('ignores comments and indented lines', () => {
    const src = [
      '# big comment',
      'http:',
      '  # nested comment',
      '  routers:',
      '    foo: bar',
      '',
    ].join('\n');
    expect(classifyTraefikFile(src)).toBe('dynamic');
  });
});

describe('typesCompatible', () => {
  it('matches identical types', () => {
    expect(typesCompatible('static', 'static')).toBe(true);
    expect(typesCompatible('dynamic', 'dynamic')).toBe(true);
  });
  it('forbids static <-> dynamic', () => {
    expect(typesCompatible('static', 'dynamic')).toBe(false);
    expect(typesCompatible('dynamic', 'static')).toBe(false);
  });
  it('treats unknown as compatible with anything', () => {
    expect(typesCompatible('unknown', 'static')).toBe(true);
    expect(typesCompatible('static', 'unknown')).toBe(true);
    expect(typesCompatible('unknown', 'unknown')).toBe(true);
  });
});
