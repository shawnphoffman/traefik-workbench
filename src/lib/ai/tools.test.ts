import { describe, it, expect } from 'vitest';

import {
  validateCompletionItems,
  validateDiagnostics,
  validateFormatted,
} from './tools';

describe('validateCompletionItems', () => {
  it('keeps well-formed items', () => {
    const out = validateCompletionItems({
      items: [
        { label: 'service', insertText: 'service: ' },
        { label: 'middleware', insertText: 'middleware: ', detail: 'mw' },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ label: 'service', insertText: 'service: ' });
    expect(out[1].detail).toBe('mw');
  });

  it('drops items that are missing required fields', () => {
    const out = validateCompletionItems({
      items: [
        { label: 'ok', insertText: 'ok' },
        { label: '' },
        { insertText: 'no label' },
        { label: 'no insert' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('ok');
  });

  it('caps to 8 items', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      label: `l${i}`,
      insertText: `i${i}`,
    }));
    const out = validateCompletionItems({ items });
    expect(out).toHaveLength(8);
  });

  it('throws on a malformed top-level shape', () => {
    expect(() => validateCompletionItems(null)).toThrow();
    expect(() => validateCompletionItems({ items: 'no' })).toThrow();
  });
});

describe('validateDiagnostics', () => {
  it('keeps well-formed diagnostics and tags them with source=claude', () => {
    const out = validateDiagnostics({
      diagnostics: [
        { line: 1, column: 1, severity: 'error', message: 'broke' },
        {
          line: 5,
          column: 3,
          endLine: 5,
          endColumn: 8,
          severity: 'warning',
          message: 'meh',
        },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      line: 1,
      column: 1,
      severity: 'error',
      message: 'broke',
      source: 'claude',
    });
    expect(out[1].endLine).toBe(5);
    expect(out[1].endColumn).toBe(8);
  });

  it('drops diagnostics with bad severity', () => {
    const out = validateDiagnostics({
      diagnostics: [
        { line: 1, column: 1, severity: 'fatal', message: 'no' },
        { line: 1, column: 1, severity: 'error', message: 'yes' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].message).toBe('yes');
  });

  it('drops diagnostics with non-positive coordinates', () => {
    const out = validateDiagnostics({
      diagnostics: [
        { line: 0, column: 1, severity: 'error', message: 'no' },
        { line: 1, column: 0, severity: 'error', message: 'no' },
      ],
    });
    expect(out).toHaveLength(0);
  });

  it('caps to 20 diagnostics', () => {
    const diagnostics = Array.from({ length: 50 }, (_, i) => ({
      line: i + 1,
      column: 1,
      severity: 'error',
      message: 'm',
    }));
    const out = validateDiagnostics({ diagnostics });
    expect(out).toHaveLength(20);
  });
});

describe('validateFormatted', () => {
  it('returns the formatted string', () => {
    expect(validateFormatted({ formatted: 'foo: bar\n' })).toBe('foo: bar\n');
  });
  it('throws on missing field', () => {
    expect(() => validateFormatted({})).toThrow();
    expect(() => validateFormatted({ formatted: 12 })).toThrow();
    expect(() => validateFormatted(null)).toThrow();
  });
});
