'use client';

/**
 * Single text-input dialog used for "New file", "New folder", and
 * similar name/path prompts.
 *
 * Supports:
 * - An optional `validate` callback that returns an error message string
 *   or null — re-run on every keystroke
 * - An optional `initialValue` that's selected on open (so you can type
 *   over a suggested default)
 * - Submits on Enter
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  Dialog,
  DialogBody,
  DialogCancelButton,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
} from './Dialog';

export interface InputDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}

export function InputDialog({
  open,
  title,
  description,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'Create',
  cancelLabel = 'Cancel',
  validate,
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState<string>(initialValue);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state each time the dialog is opened so reuse doesn't leak
  // stale input from a prior invocation.
  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setSubmitError(null);
      setBusy(false);
      // Focus + select-all after the dialog has actually opened.
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, initialValue]);

  const validationError = validate ? validate(value) : null;
  const canSubmit = !busy && value.trim().length > 0 && validationError == null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await onConfirm(value);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onCancel}>
      <form onSubmit={handleSubmit}>
        <DialogHeader title={title} />
        <DialogBody>
          {description && (
            <div className="mb-3 text-sm text-neutral-300">{description}</div>
          )}
          {label && (
            <label className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
              {label}
            </label>
          )}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          {validationError && value.trim().length > 0 && (
            <div className="mt-2 text-xs text-red-400">{validationError}</div>
          )}
          {submitError && (
            <div className="mt-2 text-xs text-red-400">{submitError}</div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogCancelButton onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </DialogCancelButton>
          <DialogPrimaryButton type="submit" disabled={!canSubmit}>
            {busy ? 'Working…' : confirmLabel}
          </DialogPrimaryButton>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
