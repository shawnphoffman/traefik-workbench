'use client';

/**
 * AI section of the Settings page. Handles:
 *   - Master enable toggle
 *   - API key entry (masked + reveal-on-paste)
 *   - Model selection
 *   - Per-feature toggles (completion, validation, format)
 *   - Test connection
 *
 * Save semantics: every change posts a partial PATCH to /api/settings.
 * No explicit "Save" button — it's a settings page, not a form.
 */

import { useCallback, useState } from 'react';
import { CheckCircle2, ExternalLink, KeyRound, Loader2, Sparkles, XCircle } from 'lucide-react';

import { testSettings } from '@/lib/api-client';
import {
  AI_MODEL_CHOICES,
  type AiModel,
  type MaskedSettings,
  type SettingsPatch,
} from '@/lib/settings/types';

export interface AiSettingsSectionProps {
  settings: MaskedSettings;
  onPatch: (patch: SettingsPatch) => Promise<void>;
  onAfterTest?: () => void;
}

type TestResult =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; model: string }
  | {
      kind: 'error';
      message: string;
      status?: number | null;
      type?: string | null;
    };

export function AiSettingsSection({
  settings,
  onPatch,
  onAfterTest,
}: AiSettingsSectionProps) {
  const [keyDraft, setKeyDraft] = useState<string>('');
  const [showKeyInput, setShowKeyInput] = useState<boolean>(false);
  const [test, setTest] = useState<TestResult>({ kind: 'idle' });

  const apiKeyFromEnv = settings.ai.apiKeySource === 'env';

  const handleEnabled = useCallback(
    (enabled: boolean) => {
      void onPatch({ ai: { enabled } });
    },
    [onPatch],
  );

  const handleModel = useCallback(
    (model: AiModel) => {
      void onPatch({ ai: { model } });
    },
    [onPatch],
  );

  const handleFeature = useCallback(
    (feature: 'completion' | 'validation' | 'format', value: boolean) => {
      void onPatch({ ai: { features: { [feature]: value } } });
    },
    [onPatch],
  );

  const handleSaveKey = useCallback(async () => {
    if (keyDraft.length === 0) return;
    // First-run UX: if AI was disabled because there was no key, flip the
    // master switch on at the same time as the key save so the user doesn't
    // have to chase a second toggle. We only auto-enable when transitioning
    // from "no key" → "key set", not on every replace.
    const wasUnset = settings.ai.apiKeySource === 'none';
    await onPatch({
      ai: wasUnset ? { apiKey: keyDraft, enabled: true } : { apiKey: keyDraft },
    });
    setKeyDraft('');
    setShowKeyInput(false);
    // Immediately ping Claude so the user gets confirmation the key works.
    setTest({ kind: 'pending' });
    const result = await testSettings();
    if (result.ok) {
      setTest({ kind: 'ok', model: result.model ?? settings.ai.model });
    } else {
      setTest({
        kind: 'error',
        message: result.error ?? 'Unknown error',
        status: result.status ?? null,
        type: result.type ?? null,
      });
    }
    onAfterTest?.();
  }, [keyDraft, onPatch, settings.ai.apiKeySource, settings.ai.model, onAfterTest]);

  const handleClearKey = useCallback(async () => {
    await onPatch({ ai: { apiKey: null } });
    setKeyDraft('');
    setShowKeyInput(false);
  }, [onPatch]);

  const handleTest = useCallback(async () => {
    setTest({ kind: 'pending' });
    const result = await testSettings();
    if (result.ok) {
      setTest({ kind: 'ok', model: result.model ?? settings.ai.model });
    } else {
      setTest({
        kind: 'error',
        message: result.error ?? 'Unknown error',
        status: result.status ?? null,
        type: result.type ?? null,
      });
    }
    onAfterTest?.();
  }, [settings.ai.model, onAfterTest]);

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <Sparkles className="h-4 w-4 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-neutral-100">
          Claude AI integration
        </h2>
      </header>

      <div className="flex flex-col gap-5 p-4">
        {/* Enable */}
        <Field
          label="Enable AI features"
          description="Master switch. When off, no /api/ai/* requests are made and the editor behaves identically to the base workbench."
        >
          <div className="flex flex-col gap-1.5">
            <Toggle
              checked={settings.ai.enabled}
              onChange={handleEnabled}
              disabled={settings.ai.apiKeySource === 'none'}
            />
            {settings.ai.apiKeySource === 'none' && (
              <p className="text-sm text-neutral-500">
                Set an API key below to enable.
              </p>
            )}
          </div>
        </Field>

        {/* API key */}
        <Field
          label="Anthropic API key"
          description={
            apiKeyFromEnv ? (
              'Read from the ANTHROPIC_API_KEY environment variable. Set the env var to empty and restart to manage the key from this page.'
            ) : (
              <>
                Stored in CONFIG_DIR/settings.json (mode 0600). Treat the
                config volume as a secret.{' '}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-0.5 text-sky-400 underline-offset-2 hover:text-sky-300 hover:underline"
                >
                  Get an API key
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </>
            )
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <KeyRound
                className="h-4 w-4 text-neutral-400"
                aria-hidden="true"
              />
              <code
                tabIndex={0}
                aria-label={
                  settings.ai.apiKeyMasked
                    ? `Anthropic API key, masked: ${settings.ai.apiKeyMasked}`
                    : 'Anthropic API key not set'
                }
                className="rounded bg-neutral-900 px-2.5 py-1 font-mono text-base text-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
              >
                {settings.ai.apiKeyMasked ?? 'not set'}
              </code>
              <SourceBadge source={settings.ai.apiKeySource} />
            </div>
            {!apiKeyFromEnv && !showKeyInput && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowKeyInput(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-base font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100"
                >
                  {settings.ai.apiKeyMasked ? 'Replace key' : 'Set key'}
                </button>
                {settings.ai.apiKeyMasked && (
                  <button
                    type="button"
                    onClick={() => void handleClearKey()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-3 text-base font-medium text-neutral-400 transition-colors hover:border-red-800 hover:bg-red-950/40 hover:text-red-200"
                  >
                    Clear key
                  </button>
                )}
              </div>
            )}
            {!apiKeyFromEnv && showKeyInput && (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  autoFocus
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="sk-ant-..."
                  className="h-10 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 font-mono text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-sky-600"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveKey()}
                  disabled={keyDraft.length === 0}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md border border-sky-700 bg-sky-950 px-4 text-base font-medium text-sky-100 transition-colors hover:bg-sky-900 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowKeyInput(false);
                    setKeyDraft('');
                  }}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-4 text-base font-medium text-neutral-300 transition-colors hover:border-neutral-600"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </Field>

        {/* Model */}
        <Field
          label="Model"
          description="Used for completion, validation, and format. Haiku is fastest and cheapest; Sonnet has stronger multi-file reasoning."
        >
          <select
            value={settings.ai.model}
            onChange={(e) => handleModel(e.target.value as AiModel)}
            className="h-10 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 font-mono text-base text-neutral-100 outline-none focus:border-sky-600"
          >
            {AI_MODEL_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        {/* Features */}
        <Field
          label="Features"
          description="Each can be toggled independently. The on-disk key and master enable still apply."
        >
          <div className="flex flex-col gap-2">
            <FeatureRow
              label="Completion"
              hint="Ctrl+Space in the editor"
              checked={settings.ai.features.completion}
              onChange={(v) => handleFeature('completion', v)}
            />
            <FeatureRow
              label="Validation"
              hint="Diagnostics in the editor gutter"
              checked={settings.ai.features.validation}
              onChange={(v) => handleFeature('validation', v)}
            />
            <FeatureRow
              label="Format"
              hint="Cmd/Ctrl+Shift+F in the editor"
              checked={settings.ai.features.format}
              onChange={(v) => handleFeature('format', v)}
            />
          </div>
        </Field>

        {/* Test */}
        <Field label="Test connection" description="Sends a single tiny ping to Claude to verify the key works.">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={test.kind === 'pending' || settings.ai.apiKeySource === 'none'}
              className="inline-flex h-10 w-fit items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-4 text-base font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600"
            >
              {test.kind === 'pending' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {test.kind === 'pending' ? 'Testing…' : 'Test connection'}
            </button>
            {test.kind === 'ok' && (
              <div className="flex items-center gap-1.5 text-base text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Connected ({test.model})
              </div>
            )}
            {test.kind === 'error' && <TestErrorCard error={test} />}
          </div>
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
      <div>
        <div className="text-base font-semibold text-neutral-200">{label}</div>
        {description && (
          <div className="mt-1 text-sm text-neutral-500">{description}</div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked
          ? 'border-sky-700 bg-sky-700'
          : 'border-neutral-700 bg-neutral-800'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-neutral-100 transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function FeatureRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div>
        <div className="text-base font-medium text-neutral-200">{label}</div>
        <div className="text-sm text-neutral-500">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function TestErrorCard({
  error,
}: {
  error: {
    message: string;
    status?: number | null;
    type?: string | null;
  };
}) {
  // Build a short, human-readable title from whatever metadata we have:
  //   "HTTP 400 · invalid_request_error"
  //   "HTTP 401"
  //   "Connection error"
  const parts: string[] = [];
  if (typeof error.status === 'number') parts.push(`HTTP ${error.status}`);
  if (error.type) parts.push(error.type);
  const title = parts.length > 0 ? parts.join(' · ') : 'Connection failed';

  return (
    <div
      role="alert"
      className="flex w-full max-w-2xl items-start gap-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2.5"
    >
      <XCircle
        className="mt-0.5 h-4 w-4 shrink-0 text-red-400"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="text-sm font-semibold text-red-200">{title}</div>
        <div className="break-words text-sm text-red-100/90">
          {error.message}
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: 'file' | 'env' | 'none' }) {
  // No badge when there's no key — the masked code already renders "not set".
  if (source === 'none') return null;
  const text = source === 'file' ? 'from settings' : 'from env';
  const cls =
    source === 'file'
      ? 'border-sky-800/60 bg-sky-500/10 text-sky-300'
      : 'border-amber-800/60 bg-amber-500/10 text-amber-300';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {text}
    </span>
  );
}
