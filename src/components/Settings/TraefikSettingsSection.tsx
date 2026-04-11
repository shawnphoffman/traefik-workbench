'use client';

/**
 * Traefik section of the Settings page. Holds the connection details
 * the workbench needs to talk to the user's running Traefik instance:
 *   - Base URL (e.g. http://traefik:8080)
 *   - Auth (none / basic)
 *   - Skip TLS verification
 *   - Ping path / timeout
 *
 * The settings file is the source of truth for the connection — the
 * `/traefik` page itself has no editing affordance, just an empty
 * state that links back here when nothing is configured.
 *
 * Save semantics: a draft form with an explicit "Save" button. We
 * don't fire a PATCH on every keystroke because (a) the password
 * field is sensitive and (b) saving a half-typed URL would burn a
 * round trip on every character. The "Test connection" button is
 * disabled until the saved config is reachable.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Network,
  XCircle,
} from 'lucide-react';

import { testTraefik } from '@/lib/api-client';
import type {
  MaskedSettings,
  MaskedTraefikSettings,
  SettingsPatch,
  TraefikAuthPatch,
} from '@/lib/settings/types';

export interface TraefikSettingsSectionProps {
  settings: MaskedSettings;
  onPatch: (patch: SettingsPatch) => Promise<void>;
}

type TestResult =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'ok'; version: string; pingMs: number }
  | { kind: 'error'; code: string; message: string; status: number | null };

interface DraftState {
  baseUrl: string;
  authKind: 'none' | 'basic';
  username: string;
  /** Empty string = leave existing password alone (when one is set). */
  passwordDraft: string;
  /** True when the user pressed "Clear password" — submits null on save. */
  clearPassword: boolean;
  insecureTls: boolean;
  pingPath: string;
  timeoutMs: number;
}

function draftFromSettings(t: MaskedTraefikSettings): DraftState {
  return {
    baseUrl: t.baseUrl ?? '',
    authKind: t.auth.kind,
    username: t.auth.kind === 'basic' ? t.auth.username : '',
    passwordDraft: '',
    clearPassword: false,
    insecureTls: t.insecureTls,
    pingPath: t.pingPath ?? '',
    timeoutMs: t.timeoutMs,
  };
}

function draftEqualsSaved(d: DraftState, t: MaskedTraefikSettings): boolean {
  if ((t.baseUrl ?? '') !== d.baseUrl.trim()) return false;
  if (t.auth.kind !== d.authKind) return false;
  if (d.authKind === 'basic') {
    if (t.auth.kind !== 'basic') return false;
    if (t.auth.username !== d.username) return false;
    if (d.passwordDraft.length > 0) return false;
    if (d.clearPassword) return false;
  }
  if (t.insecureTls !== d.insecureTls) return false;
  if ((t.pingPath ?? '') !== d.pingPath.trim()) return false;
  if (t.timeoutMs !== d.timeoutMs) return false;
  return true;
}

function buildPatch(d: DraftState): SettingsPatch {
  const traefik: NonNullable<SettingsPatch['traefik']> = {
    baseUrl: d.baseUrl.trim().length > 0 ? d.baseUrl.trim() : null,
    insecureTls: d.insecureTls,
    pingPath: d.pingPath.trim().length > 0 ? d.pingPath.trim() : null,
    timeoutMs: d.timeoutMs,
  };
  let auth: TraefikAuthPatch;
  if (d.authKind === 'none') {
    auth = { kind: 'none' };
  } else {
    auth = { kind: 'basic', username: d.username };
    if (d.clearPassword) {
      auth.password = null;
    } else if (d.passwordDraft.length > 0) {
      auth.password = d.passwordDraft;
    }
    // Otherwise omit password — leaves the existing one alone.
  }
  traefik.auth = auth;
  return { traefik };
}

export function TraefikSettingsSection({
  settings,
  onPatch,
}: TraefikSettingsSectionProps) {
  const t = settings.traefik;
  const [draft, setDraft] = useState<DraftState>(() => draftFromSettings(t));
  const [saving, setSaving] = useState<boolean>(false);
  const [test, setTest] = useState<TestResult>({ kind: 'idle' });

  // Re-sync the draft from props when the saved settings change *and*
  // the user hasn't started editing — same defensive pattern as
  // TreeSettingsSection.
  useEffect(() => {
    setDraft((current) => {
      if (draftEqualsSaved(current, t)) {
        return draftFromSettings(t);
      }
      return current;
    });
  }, [t]);

  const dirty = !draftEqualsSaved(draft, t);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setTest({ kind: 'idle' });
    try {
      await onPatch(buildPatch(draft));
      // Clear the password draft + clear flag now that they've been
      // committed; the masked response will reflect the new state.
      setDraft((d) => ({ ...d, passwordDraft: '', clearPassword: false }));
    } finally {
      setSaving(false);
    }
  }, [draft, onPatch]);

  const handleReset = useCallback(() => {
    setDraft(draftFromSettings(t));
    setTest({ kind: 'idle' });
  }, [t]);

  const handleTest = useCallback(async () => {
    setTest({ kind: 'pending' });
    const result = await testTraefik();
    if (result.ok) {
      setTest({
        kind: 'ok',
        version: result.version ?? 'unknown',
        pingMs: result.pingMs ?? 0,
      });
    } else {
      setTest({
        kind: 'error',
        code: result.code ?? 'HTTP_ERROR',
        message: result.error ?? 'Unknown error',
        status: result.status ?? null,
      });
    }
  }, []);

  // Test is meaningful only against saved config — testing a draft
  // would lie about what /api/traefik/* will actually do at runtime.
  const canTest = t.configured && !dirty && test.kind !== 'pending';

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-950">
      <header className="flex items-center gap-2 border-b border-neutral-800 px-4 py-3">
        <Network className="h-4 w-4 text-sky-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-neutral-100">
          Traefik instance
        </h2>
      </header>

      <div className="flex flex-col gap-5 p-4">
        <p className="text-sm text-neutral-500">
          Connection details for the Traefik instance whose dynamic config
          this workbench edits. Used by the read-only{' '}
          <code className="rounded bg-neutral-800 px-1 font-mono text-xs">
            /traefik
          </code>{' '}
          page to show live state and surface configuration issues. The
          workbench never writes back to the Traefik API.
        </p>

        {/* Base URL */}
        <Field
          label="Base URL"
          description={
            <>
              Where Traefik&apos;s REST API is reachable from this container,
              e.g.{' '}
              <code className="rounded bg-neutral-800 px-1 font-mono text-xs">
                http://traefik:8080
              </code>
              . Can also be set via{' '}
              <code className="rounded bg-neutral-800 px-1 font-mono text-xs">
                TRAEFIK_API_URL
              </code>
              .
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={draft.baseUrl}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, baseUrl: e.target.value }))
                }
                placeholder="http://traefik:8080"
                spellCheck={false}
                className="h-10 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 font-mono text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-sky-600"
              />
              <SourceBadge source={t.baseUrlSource} />
            </div>
          </div>
        </Field>

        {/* Auth mode */}
        <Field
          label="Authentication"
          description="Traefik's API has no built-in auth. Pick 'Basic' if your dashboard router is wrapped in a BasicAuth middleware; otherwise leave it on 'None'."
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <select
                value={draft.authKind}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    authKind: e.target.value as 'none' | 'basic',
                  }))
                }
                className="h-10 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 text-base text-neutral-100 outline-none focus:border-sky-600"
              >
                <option value="none">None</option>
                <option value="basic">Basic auth</option>
              </select>
            </div>

            {draft.authKind === 'basic' && (
              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  autoComplete="off"
                  value={draft.username}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, username: e.target.value }))
                  }
                  placeholder="username"
                  className="h-10 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 font-mono text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-sky-600"
                />
                <div className="flex items-center gap-2">
                  <KeyRound
                    className="h-4 w-4 text-neutral-400"
                    aria-hidden="true"
                  />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={draft.passwordDraft}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        passwordDraft: e.target.value,
                        clearPassword: false,
                      }))
                    }
                    placeholder={
                      t.auth.kind === 'basic' && t.auth.passwordSet
                        ? '••••••• (saved — leave blank to keep)'
                        : 'password'
                    }
                    className="h-10 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 font-mono text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-sky-600"
                  />
                  {t.auth.kind === 'basic' && t.auth.passwordSet && (
                    <SourceBadge source={t.auth.passwordSource} />
                  )}
                </div>
                {t.auth.kind === 'basic' && t.auth.passwordSet && (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        passwordDraft: '',
                        clearPassword: !d.clearPassword,
                      }))
                    }
                    className={`inline-flex h-9 w-fit items-center gap-1.5 rounded-md border px-3 text-base font-medium transition-colors ${
                      draft.clearPassword
                        ? 'border-amber-800/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                        : 'border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-red-800 hover:bg-red-950/40 hover:text-red-200'
                    }`}
                  >
                    {draft.clearPassword
                      ? 'Will clear on save — click to undo'
                      : 'Clear password'}
                  </button>
                )}
              </div>
            )}
          </div>
        </Field>

        {/* Skip TLS verify */}
        <Field
          label="Skip TLS verification"
          description="Allow self-signed or otherwise unverifiable certs. Server-side fetch only — never affects the browser."
        >
          <Toggle
            checked={draft.insecureTls}
            onChange={(v) =>
              setDraft((d) => ({ ...d, insecureTls: v }))
            }
          />
        </Field>

        {/* Ping path */}
        <Field
          label="Ping path"
          description={
            <>
              Path used for the liveness check. Default{' '}
              <code className="rounded bg-neutral-800 px-1 font-mono text-xs">
                /ping
              </code>
              . Leave blank to skip ping (the workbench will fall back to{' '}
              <code className="rounded bg-neutral-800 px-1 font-mono text-xs">
                /api/version
              </code>
              ).
            </>
          }
        >
          <input
            type="text"
            value={draft.pingPath}
            onChange={(e) =>
              setDraft((d) => ({ ...d, pingPath: e.target.value }))
            }
            placeholder="/ping"
            className="h-10 w-48 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 font-mono text-base text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-sky-600"
          />
        </Field>

        {/* Timeout */}
        <Field
          label="Timeout"
          description="Per-request timeout in milliseconds (250–60 000). 5 000 is a reasonable default for a local Traefik."
        >
          <input
            type="number"
            min={250}
            max={60_000}
            step={250}
            value={draft.timeoutMs}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                timeoutMs: Number.parseInt(e.target.value, 10) || 5_000,
              }))
            }
            className="h-10 w-32 rounded-md border border-neutral-700 bg-neutral-900 px-2.5 font-mono text-base text-neutral-100 outline-none focus:border-sky-600"
          />
        </Field>

        {/* Save / Reset / Test */}
        <Field label="" description="">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-sky-700 bg-sky-950 px-4 text-base font-medium text-sky-100 transition-colors hover:bg-sky-900 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600"
              >
                {saving ? 'Saving…' : 'Save connection'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={!dirty || saving}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 text-base font-medium text-neutral-300 transition-colors hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={!canTest}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-4 text-base font-medium text-neutral-200 transition-colors hover:border-sky-700 hover:bg-sky-950 hover:text-sky-100 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-950 disabled:text-neutral-600"
              >
                {test.kind === 'pending' ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Network className="h-4 w-4" aria-hidden="true" />
                )}
                {test.kind === 'pending' ? 'Testing…' : 'Test connection'}
              </button>
            </div>
            {!t.configured && (
              <p className="text-sm text-neutral-500">
                Save a base URL to enable the test button and the{' '}
                <code className="rounded bg-neutral-800 px-1 font-mono text-xs">
                  /traefik
                </code>{' '}
                page.
              </p>
            )}
            {dirty && t.configured && (
              <p className="text-sm text-amber-300">
                Save your changes to test the new configuration.
              </p>
            )}
            {test.kind === 'ok' && (
              <div className="flex items-center gap-1.5 text-base text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Connected to Traefik {test.version} ({test.pingMs} ms)
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
        {label && (
          <div className="text-base font-semibold text-neutral-200">{label}</div>
        )}
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
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
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

function SourceBadge({ source }: { source: 'file' | 'env' | 'none' }) {
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

function TestErrorCard({
  error,
}: {
  error: { code: string; message: string; status: number | null };
}) {
  const parts: string[] = [];
  if (typeof error.status === 'number') parts.push(`HTTP ${error.status}`);
  parts.push(error.code);
  const title = parts.join(' · ');
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
        <div className="break-words text-sm text-red-100/90">{error.message}</div>
      </div>
    </div>
  );
}
