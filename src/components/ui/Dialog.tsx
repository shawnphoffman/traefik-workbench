'use client';

/**
 * Thin wrapper around the native <dialog> element.
 *
 * Native <dialog> gives us modal backdrop, focus trap, and Escape-to-
 * close for free. We just need to call `showModal()` / `close()` in
 * response to the `open` prop and propagate the native `close` event
 * back up to the parent so it can flip its own state.
 *
 * Clicking outside the dialog surface (on the backdrop) also closes
 * it. We detect this by checking whether the click target is the
 * dialog element itself — the backdrop pseudo-element is treated as
 * part of the dialog for hit-testing.
 *
 * Styling:
 * - `:modal` variant applies when open as a modal (we use `open:` here)
 * - `::backdrop` styles the native backdrop via the `backdrop:` variant
 * - Tailwind reset removes the default padding; we re-apply our own.
 */

import { useEffect, useRef, type ReactNode } from 'react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Close when the user clicks the backdrop. Defaults to true. */
  dismissOnBackdropClick?: boolean;
  /** Width class (Tailwind). Default: `max-w-md`. */
  widthClassName?: string;
  children: ReactNode;
}

export function Dialog({
  open,
  onClose,
  dismissOnBackdropClick = true,
  widthClassName = 'max-w-md',
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // Sync the `open` prop to the imperative <dialog> API.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  // Propagate native `close` events (Escape key, form-method=dialog
  // button) back up to the parent.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => onClose();
    el.addEventListener('close', handleClose);
    return () => el.removeEventListener('close', handleClose);
  }, [onClose]);

  const handleClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (!dismissOnBackdropClick) return;
    // A click directly on the <dialog> element (not its inner content)
    // means the backdrop was clicked.
    if (e.target === e.currentTarget) {
      ref.current?.close();
    }
  };

  return (
    <dialog
      ref={ref}
      onClick={handleClick}
      // `m-auto` + `inset-0` restores the browser's native centering
      // behavior for modal `<dialog>` — Tailwind v4's preflight resets
      // `margin: 0` on all elements, which otherwise pins the dialog
      // to the top-left corner.
      className={`fixed inset-0 m-auto w-full ${widthClassName} rounded-lg border border-neutral-700 bg-neutral-900 p-0 text-neutral-100 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm open:animate-in`}
    >
      {children}
    </dialog>
  );
}

/** Standard padded header for a Dialog. */
export function DialogHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  /**
   * Optional leading icon rendered in a circular badge. Callers should
   * supply their own color classes (e.g. the ConfirmDialog danger
   * variant uses an amber triangle).
   */
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-neutral-800 px-5 py-4">
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-medium text-neutral-100">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-xs text-neutral-400">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/** Standard padded body container. */
export function DialogBody({ children }: { children: ReactNode }) {
  return <div className="px-5 py-4">{children}</div>;
}

/** Standard padded footer; right-aligns its children. */
export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3">
      {children}
    </div>
  );
}

/** Primary (accent) button styled for dialog footers. */
export function DialogPrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex items-center rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Destructive (red) button styled for dialog footers. */
export function DialogDangerButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Ghost cancel button styled for dialog footers. */
export function DialogCancelButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="inline-flex items-center rounded-md border border-neutral-700 bg-transparent px-3 py-1.5 text-sm font-medium text-neutral-200 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-500"
    >
      {children}
    </button>
  );
}
