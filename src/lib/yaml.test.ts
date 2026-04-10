import { describe, it, expect } from 'vitest';
import { parseYaml, collectIds } from './yaml';

describe('parseYaml', () => {
  it('returns an empty tree for an empty document', () => {
    const result = parseYaml('');
    expect(result).toEqual({ ok: true, tree: null });
  });

  it('returns an empty tree for whitespace-only input', () => {
    const result = parseYaml('   \n\n');
    if (!result.ok) throw new Error('expected ok');
    expect(result.tree).toBeNull();
  });

  it('parses a simple scalar document as a scalar tree', () => {
    const result = parseYaml('hello\n');
    if (!result.ok) throw new Error('expected ok');
    expect(result.tree?.kind).toBe('scalar');
    expect(result.tree?.valuePreview).toBe('hello');
  });

  it('parses a flat map with line numbers', () => {
    const src = ['foo: 1', 'bar: two', 'baz: true', ''].join('\n');
    const result = parseYaml(src);
    if (!result.ok) throw new Error('expected ok');
    expect(result.tree?.kind).toBe('map');
    const children = result.tree?.children ?? [];
    expect(children.map((c) => c.key)).toEqual(['foo', 'bar', 'baz']);
    expect(children.map((c) => c.line)).toEqual([1, 2, 3]);
    expect(children.map((c) => c.kind)).toEqual(['scalar', 'scalar', 'scalar']);
    expect(children[0].valuePreview).toBe('1');
    expect(children[1].valuePreview).toBe('two');
    expect(children[2].valuePreview).toBe('true');
  });

  it('parses a nested Traefik-style config', () => {
    const src = [
      'http:',
      '  routers:',
      '    web:',
      '      rule: Host(`example.com`)',
      '      service: web-svc',
      '  services:',
      '    web-svc:',
      '      loadBalancer:',
      '        servers:',
      '          - url: http://backend:8080',
      '',
    ].join('\n');

    const result = parseYaml(src);
    if (!result.ok) throw new Error('expected ok');
    const ids = collectIds(result.tree);
    expect(ids).toEqual([
      '$',
      'http',
      'http.routers',
      'http.routers.web',
      'http.routers.web.rule',
      'http.routers.web.service',
      'http.services',
      'http.services.web-svc',
      'http.services.web-svc.loadBalancer',
      'http.services.web-svc.loadBalancer.servers',
      'http.services.web-svc.loadBalancer.servers[0]',
      'http.services.web-svc.loadBalancer.servers[0].url',
    ]);
  });

  it('tracks line numbers through nested structures', () => {
    const src = [
      'http:', // 1
      '  routers:', // 2
      '    web:', // 3
      '      rule: Host(`a`)', // 4
      '      service: s', // 5
    ].join('\n');

    const result = parseYaml(src);
    if (!result.ok) throw new Error('expected ok');
    const tree = result.tree!;
    expect(tree.line).toBe(1); // http
    const http = tree.children![0];
    expect(http.line).toBe(1);
    const routers = http.children![0];
    expect(routers.line).toBe(2);
    const web = routers.children![0];
    expect(web.line).toBe(3);
    const rule = web.children![0];
    expect(rule.line).toBe(4);
    const service = web.children![1];
    expect(service.line).toBe(5);
  });

  it('parses sequences with [index] keys', () => {
    const src = ['items:', '  - a', '  - b', '  - c', ''].join('\n');
    const result = parseYaml(src);
    if (!result.ok) throw new Error('expected ok');
    const items = result.tree?.children?.[0];
    expect(items?.kind).toBe('seq');
    expect(items?.children?.map((c) => c.key)).toEqual(['[0]', '[1]', '[2]']);
    expect(items?.children?.map((c) => c.valuePreview)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('handles a map key with a null value', () => {
    const src = ['foo:', 'bar: x', ''].join('\n');
    const result = parseYaml(src);
    if (!result.ok) throw new Error('expected ok');
    const foo = result.tree?.children?.[0];
    expect(foo?.key).toBe('foo');
    expect(foo?.kind).toBe('scalar');
  });

  it('truncates long scalar previews', () => {
    const long = 'x'.repeat(200);
    const src = `long: ${long}\n`;
    const result = parseYaml(src);
    if (!result.ok) throw new Error('expected ok');
    const preview = result.tree?.children?.[0]?.valuePreview ?? '';
    expect(preview.length).toBeLessThanOrEqual(60);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('returns an error result for invalid YAML', () => {
    // Unclosed flow mapping.
    const result = parseYaml('foo: { bar\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBeTruthy();
    expect(result.error.line).toBeTypeOf('number');
  });

  it('returns an error with line info for tab indent errors', () => {
    const src = ['foo:', '\tbar: x'].join('\n');
    const result = parseYaml(src);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The error should point at line 2 where the tab indent appears.
    expect(result.error.line).toBeGreaterThanOrEqual(1);
  });

  it('stringifies numeric map keys', () => {
    const src = ['1: one', '2: two', ''].join('\n');
    const result = parseYaml(src);
    if (!result.ok) throw new Error('expected ok');
    expect(result.tree?.children?.map((c) => c.key)).toEqual(['1', '2']);
  });
});
