import { describe, it, expect } from 'vitest';

import { yamlAstEqual } from './astEqual';

describe('yamlAstEqual', () => {
  it('returns equal for identical input', () => {
    const yaml = 'http:\n  routers:\n    web:\n      rule: "Host(`x`)"\n';
    expect(yamlAstEqual(yaml, yaml).equal).toBe(true);
  });

  it('returns equal across whitespace-only differences', () => {
    const a = 'foo: 1\nbar: 2\n';
    const b = 'foo:  1\nbar:    2\n';
    expect(yamlAstEqual(a, b).equal).toBe(true);
  });

  it('returns equal across reordered map keys', () => {
    const a = 'foo: 1\nbar: 2\n';
    const b = 'bar: 2\nfoo: 1\n';
    expect(yamlAstEqual(a, b).equal).toBe(true);
  });

  it('returns equal across comment changes', () => {
    const a = '# comment\nfoo: 1\n';
    const b = 'foo: 1 # different comment\n';
    expect(yamlAstEqual(a, b).equal).toBe(true);
  });

  it('detects a value change', () => {
    const a = 'foo: 1\nbar: 2\n';
    const b = 'foo: 1\nbar: 99\n';
    const result = yamlAstEqual(a, b);
    expect(result.equal).toBe(false);
    expect(result.diff).toBe('bar');
  });

  it('detects a key rename', () => {
    const a = 'http:\n  routers: {}\n';
    const b = 'http:\n  routes: {}\n';
    const result = yamlAstEqual(a, b);
    expect(result.equal).toBe(false);
    expect(result.diff).toContain('http');
  });

  it('refuses to coerce a string into a number', () => {
    const a = 'port: "80"\n';
    const b = 'port: 80\n';
    expect(yamlAstEqual(a, b).equal).toBe(false);
  });

  it('detects a change in array length', () => {
    const a = 'items:\n  - 1\n  - 2\n  - 3\n';
    const b = 'items:\n  - 1\n  - 2\n';
    expect(yamlAstEqual(a, b).equal).toBe(false);
  });

  it('returns equal for two empty documents', () => {
    expect(yamlAstEqual('', '').equal).toBe(true);
    expect(yamlAstEqual('# only a comment\n', '').equal).toBe(true);
  });
});
