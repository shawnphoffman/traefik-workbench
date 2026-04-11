'use client';

/**
 * CopyTemplateDialog — turn a single template into a real data file.
 *
 * The dialog is invoked per-template from the templates pane (the
 * "copy to data" action on a row), so the source is already known.
 * Unlike the previous `TemplatesDialog`, we don't make the user pick
 * from a list — we just ask for the destination directory and filename
 * and then call `copyTemplateToData`.
 *
 * Fields:
 * - Destination directory (relative to the data root, e.g. `routers`)
 * - Destination filename (prefilled with the template's basename)
 *
 * A live preview of the computed destination path is shown below the
 * inputs so it's obvious where the file will land.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';

import {
  Dialog,
  DialogBody,
  DialogCancelButton,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
} from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { useWorkbench } from '@/components/Workbench/WorkbenchContext';
import type { TemplateEntry } from '@/types';

export interface CopyTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  /** The template being copied. Required when `open` is true. */
  template: TemplateEntry | null;
}

export function CopyTemplateDialog({
  open,
  onClose,
  template,
}: CopyTemplateDialogProps) {
  const { copyTemplateToData } = useWorkbench();
  const { toast } = useToast();

  const [directory, setDirectory] = useState<string>('');
  const [filename, setFilename] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  // Reset the fields every time a new template is opened. Using a
  // layout effect keyed on both `open` and `template.path` guarantees
  // that switching templates (or re-opening the dialog) always starts
  // from a clean, prefilled state.
  useEffect(() => {
    if (!open || !template) return;
    setDirectory('');
    setFilename(template.name);
    setBusy(false);
  }, [open, template]);

  const destinationPath = useMemo(() => {
    const dir = directory.trim().replace(/^\/+|\/+$/g, '');
    const name = filename.trim().replace(/^\/+/, '');
    if (name.length === 0) return '';
    return dir.length > 0 ? `${dir}/${name}` : name;
  }, [directory, filename]);

  const validationError = useMemo(
    () => validateDestination(directory, filename),
    [directory, filename],
  );

  const handleCopy = useCallback(async () => {
    if (!template) return;
    if (destinationPath.length === 0 || validationError) return;
    setBusy(true);
    try {
      await copyTemplateToData({
        templatePath: template.path,
        destinationPath,
      });
      toast({
        kind: 'success',
        message: `Copied template to ${destinationPath}`,
      });
      onClose();
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Template copy failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }, [
    template,
    destinationPath,
    validationError,
    copyTemplateToData,
    toast,
    onClose,
  ]);

  const canCopy =
    !busy &&
    template != null &&
    destinationPath.length > 0 &&
    validationError == null;

  return (
    <Dialog open={open} onClose={onClose} widthClassName="max-w-md">
      <DialogHeader
        title="Copy template to data"
        subtitle="Create a new config file from this template."
      />
      <DialogBody>
        <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">
          Source template
        </div>
        <div className="mb-4 flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
          <FileText
            className="h-3.5 w-3.5 shrink-0 text-neutral-500"
            aria-hidden="true"
          />
          {template ? (
            <code className="truncate font-mono text-xs">
              {template.path}
            </code>
          ) : (
            <span className="text-neutral-500">No template selected.</span>
          )}
        </div>

        <label className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
          Destination directory
        </label>
        <input
          type="text"
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
          placeholder="routers"
          disabled={!template || busy}
          autoComplete="off"
          spellCheck={false}
          aria-label="Destination directory"
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Relative to the data root. Leave blank to write to the root.
        </p>

        <label className="mb-1 mt-4 block text-xs uppercase tracking-wide text-neutral-400">
          Filename
        </label>
        <input
          type="text"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          placeholder="new-app.yml"
          disabled={!template || busy}
          autoComplete="off"
          spellCheck={false}
          aria-label="Destination filename"
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
          <div className="mb-1 uppercase tracking-wide text-neutral-500">
            Will create
          </div>
          {validationError ? (
            <span className="text-red-400">{validationError}</span>
          ) : destinationPath.length > 0 ? (
            <code className="font-mono text-neutral-200">
              {destinationPath}
            </code>
          ) : (
            <span className="text-neutral-500">Enter a filename.</span>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogCancelButton onClick={onClose} disabled={busy}>
          Cancel
        </DialogCancelButton>
        <DialogPrimaryButton onClick={handleCopy} disabled={!canCopy}>
          {busy ? 'Copying…' : 'Copy'}
        </DialogPrimaryButton>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * Validate the directory + filename fields. Returns a human-readable
 * error string, or `null` if the inputs look good. The server does its
 * own sanitization (and will reject `..` or absolute paths with a
 * 400), but catching the obvious cases client-side keeps the UX tight.
 */
function validateDestination(
  directory: string,
  filename: string,
): string | null {
  const name = filename.trim();
  if (name.length === 0) {
    // No error — the "enter a filename" hint is rendered separately.
    return null;
  }
  if (name.includes('/') || name.includes('\\')) {
    return 'Filename cannot contain slashes — use the directory field.';
  }
  if (name.startsWith('.')) {
    return 'Filename cannot start with a dot.';
  }
  if (!/\.(ya?ml)$/i.test(name)) {
    return 'Filename must end in .yml or .yaml.';
  }

  const dir = directory.trim();
  if (dir.length === 0) return null;
  if (dir.includes('\\')) {
    return 'Directory must use forward slashes.';
  }
  const segments = dir
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      return 'Directory cannot contain "." or ".." segments.';
    }
  }
  return null;
}
