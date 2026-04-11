'use client';

/**
 * Templates dialog: pick a template from the templates root, enter a
 * destination path inside the data root, and copy it via
 * `POST /api/templates`.
 *
 * Layout:
 * - Left half: scrollable list of templates
 * - Right half: preview info (name/path) + destination path input +
 *   copy button
 *
 * The templates list is fetched lazily the first time the dialog
 * opens. It's refetched on every open so new/deleted templates show
 * up without a hard reload.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';

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
import { fetchTemplates } from '@/lib/api-client';
import type { TemplateEntry } from '@/types';

export interface TemplatesDialogProps {
  open: boolean;
  onClose: () => void;
  /** Default destination directory (e.g. current selection in the tree). */
  defaultDestinationDir?: string;
}

export function TemplatesDialog({
  open,
  onClose,
  defaultDestinationDir = '',
}: TemplatesDialogProps) {
  const { copyTemplateToData } = useWorkbench();
  const { toast } = useToast();

  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [destinationPath, setDestinationPath] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  // Fetch templates each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSelectedPath(null);
    fetchTemplates()
      .then((response) => {
        if (cancelled) return;
        setTemplates(response.entries);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.path === selectedPath) ?? null,
    [templates, selectedPath],
  );

  // When a template is selected, suggest a destination path based on
  // the default destination directory + the template's basename.
  useEffect(() => {
    if (!selectedTemplate) {
      setDestinationPath('');
      return;
    }
    const suggested =
      defaultDestinationDir.length > 0
        ? `${defaultDestinationDir.replace(/\/+$/, '')}/${selectedTemplate.name}`
        : selectedTemplate.name;
    setDestinationPath(suggested);
  }, [selectedTemplate, defaultDestinationDir]);

  const handleCopy = useCallback(async () => {
    if (!selectedTemplate) return;
    const dest = destinationPath.trim();
    if (dest.length === 0) return;
    setBusy(true);
    try {
      await copyTemplateToData({
        templatePath: selectedTemplate.path,
        destinationPath: dest,
      });
      toast({
        kind: 'success',
        message: `Copied template to ${dest}`,
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
  }, [selectedTemplate, destinationPath, copyTemplateToData, toast, onClose]);

  const canCopy =
    !busy && selectedTemplate != null && destinationPath.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} widthClassName="max-w-2xl">
      <DialogHeader
        title="Templates"
        subtitle="Copy a starter file from the templates directory into your config."
      />
      <DialogBody>
        <div className="grid grid-cols-2 gap-4" style={{ minHeight: '260px' }}>
          {/* Template list */}
          <div className="flex min-h-0 flex-col rounded-md border border-neutral-800 bg-neutral-950">
            <div className="border-b border-neutral-800 px-3 py-2 text-xs uppercase tracking-wide text-neutral-400">
              Available
            </div>
            <div className="flex-1 overflow-auto">
              {loading && (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500">
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  <span>Loading…</span>
                </div>
              )}
              {loadError && !loading && (
                <div className="flex items-start gap-2 px-3 py-2 text-sm text-red-400">
                  <AlertCircle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{loadError}</span>
                </div>
              )}
              {!loading && !loadError && templates.length === 0 && (
                <div className="px-3 py-2 text-sm text-neutral-500">
                  No templates found.
                </div>
              )}
              {!loading && !loadError && templates.length > 0 && (
                <ul>
                  {templates.map((t) => (
                    <li key={t.path}>
                      <button
                        type="button"
                        onClick={() => setSelectedPath(t.path)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                          selectedPath === t.path
                            ? 'bg-sky-900/40 text-sky-100'
                            : 'text-neutral-200 hover:bg-neutral-900'
                        }`}
                      >
                        <FileText
                          className="h-3.5 w-3.5 shrink-0 text-neutral-400"
                          aria-hidden="true"
                        />
                        <span className="truncate">{t.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Destination form */}
          <div className="flex min-h-0 flex-col">
            <div className="mb-1 text-xs uppercase tracking-wide text-neutral-400">
              Source
            </div>
            <div className="mb-3 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
              {selectedTemplate ? (
                <code className="font-mono text-xs">
                  {selectedTemplate.path}
                </code>
              ) : (
                <span className="text-neutral-500">
                  Select a template on the left.
                </span>
              )}
            </div>

            <label className="mb-1 block text-xs uppercase tracking-wide text-neutral-400">
              Destination path
            </label>
            <input
              type="text"
              value={destinationPath}
              onChange={(e) => setDestinationPath(e.target.value)}
              placeholder="routers/new-app.yml"
              disabled={!selectedTemplate}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="mt-2 text-xs text-neutral-500">
              Relative to the data root. The file must not already exist.
            </p>
          </div>
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
