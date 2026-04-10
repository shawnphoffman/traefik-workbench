'use client';

/**
 * Parse a YAML source string with debouncing, so rapid edits in the
 * editor don't reparse on every keystroke.
 *
 * Design: we return the *most recent* parse result, including failed
 * parses. The caller (YamlTree panel) can decide whether to show an
 * error banner while keeping the last-known-good tree visible.
 */

import { useEffect, useState } from 'react';
import { parseYaml } from '@/lib/yaml';
import type { YamlParseResult } from '@/types';

const DEFAULT_DEBOUNCE_MS = 300;

export function useYamlParse(
  source: string,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): YamlParseResult {
  const [result, setResult] = useState<YamlParseResult>(() =>
    parseYaml(source),
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      setResult(parseYaml(source));
    }, debounceMs);
    return () => clearTimeout(handle);
  }, [source, debounceMs]);

  return result;
}
