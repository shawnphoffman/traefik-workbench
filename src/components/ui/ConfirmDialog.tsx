'use client';

/**
 * Yes/no confirmation dialog. Defaults to a destructive "Delete"
 * confirm button style — pass `variant="primary"` for non-destructive
 * confirmations.
 */

import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import {
  Dialog,
  DialogBody,
  DialogCancelButton,
  DialogDangerButton,
  DialogFooter,
  DialogHeader,
  DialogPrimaryButton,
} from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const ConfirmButton =
    variant === 'danger' ? DialogDangerButton : DialogPrimaryButton;

  const headerIcon =
    variant === 'danger' ? (
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-800/60 bg-amber-500/10 text-amber-300">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </div>
    ) : undefined;

  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogHeader title={title} icon={headerIcon} />
      {description && (
        <DialogBody>
          <div className="text-sm text-neutral-300">{description}</div>
        </DialogBody>
      )}
      <DialogFooter>
        <DialogCancelButton onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </DialogCancelButton>
        <ConfirmButton onClick={handleConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </ConfirmButton>
      </DialogFooter>
    </Dialog>
  );
}
