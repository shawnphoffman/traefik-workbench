'use client';

/**
 * Small footer pill that surfaces the AI subsystem state next to the
 * editor's existing save status. Hidden entirely when AI is disabled,
 * so the unmodified-workbench experience is unchanged.
 *
 * Tones:
 * - idle    — neutral; AI on, nothing happening
 * - thinking — sky; validation request in flight
 * - ok      — emerald; last validate returned cleanly
 * - error   — red; last validate failed (tooltip carries the message)
 */

import { AlertCircle, Loader2, Sparkles } from 'lucide-react';

import { Tooltip } from '@/components/ui/Tooltip';
import type { ValidationState } from '@/hooks/useAiValidation';
import type { FormatState } from '@/hooks/useAiFormat';

export interface AiStatusPillProps {
  enabled: boolean;
  model: string;
  validation: ValidationState;
  format: FormatState;
}

type Tone = 'idle' | 'thinking' | 'ok' | 'error';

export function AiStatusPill({
  enabled,
  model,
  validation,
  format,
}: AiStatusPillProps) {
  if (!enabled) return null;

  const { tone, label, tooltip } = resolve(validation, format, model);

  const cls = TONE_CLASS[tone];

  return (
    <Tooltip content={tooltip} placement="top">
      <span
        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
        aria-label={tooltip}
      >
        {tone === 'thinking' ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : tone === 'error' ? (
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Sparkles className="h-3 w-3" aria-hidden="true" />
        )}
        {label}
      </span>
    </Tooltip>
  );
}

function resolve(
  validation: ValidationState,
  format: FormatState,
  model: string,
): { tone: Tone; label: string; tooltip: string } {
  // Format errors take priority because they're explicit user actions
  // that just failed — that's the most useful thing to surface.
  if (format.kind === 'error') {
    return {
      tone: 'error',
      label: 'AI · format failed',
      tooltip: `Format failed: ${format.message}`,
    };
  }
  if (format.kind === 'pending') {
    return {
      tone: 'thinking',
      label: 'AI · formatting…',
      tooltip: `Claude is formatting (${model})`,
    };
  }
  if (validation.kind === 'pending') {
    return {
      tone: 'thinking',
      label: 'AI · checking…',
      tooltip: `Claude is validating (${model})`,
    };
  }
  if (validation.kind === 'error') {
    return {
      tone: 'error',
      label: 'AI · error',
      tooltip: `Validate failed: ${validation.message}`,
    };
  }
  if (validation.kind === 'ok') {
    return {
      tone: validation.count === 0 ? 'ok' : 'idle',
      label:
        validation.count === 0
          ? 'AI · clean'
          : `AI · ${validation.count} issue${validation.count === 1 ? '' : 's'}`,
      tooltip: `Claude validated (${model})`,
    };
  }
  return {
    tone: 'idle',
    label: 'AI · idle',
    tooltip: `Claude AI ready (${model})`,
  };
}

const TONE_CLASS: Record<Tone, string> = {
  idle: 'border-neutral-700 bg-neutral-900 text-neutral-300',
  thinking: 'border-sky-800/60 bg-sky-500/10 text-sky-300',
  ok: 'border-emerald-800/60 bg-emerald-500/10 text-emerald-300',
  error: 'border-red-800/60 bg-red-500/10 text-red-300',
};
