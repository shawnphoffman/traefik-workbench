'use client';

/**
 * Tiny in-house toast system. No external dependency.
 *
 * Usage:
 *   const { toast } = useToast();
 *   toast({ kind: 'error', message: 'Save failed' });
 *
 * Wrap your app in <ToastProvider> once. The container is rendered
 * bottom-right and auto-dismisses toasts after `duration` ms
 * (default 4000). Pass `duration: 0` for a sticky toast.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  X,
  type LucideProps,
} from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  message: string;
  title?: string;
  /** Milliseconds before auto-dismiss. 0 means sticky. Default 4000. */
  duration?: number;
}

interface ToastEntry extends Required<Omit<ToastOptions, 'title'>> {
  id: number;
  title?: string;
}

interface ToastContextValue {
  toast: (opts: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  // Track timer handles so we can clear them on manual dismiss.
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const nextIdRef = useRef<number>(1);

  const dismiss = useCallback((id: number) => {
    const handle = timersRef.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions): number => {
      const id = nextIdRef.current++;
      const entry: ToastEntry = {
        id,
        kind: opts.kind ?? 'info',
        message: opts.message,
        title: opts.title,
        duration: opts.duration ?? 4000,
      };
      setToasts((prev) => [...prev, entry]);
      if (entry.duration > 0) {
        const handle = setTimeout(() => dismiss(id), entry.duration);
        timersRef.current.set(id, handle);
      }
      return id;
    },
    [dismiss],
  );

  // Clear all timers on unmount so we don't leak.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const handle of timers.values()) clearTimeout(handle);
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toast, dismiss }),
    [toast, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastEntry;
  onDismiss: () => void;
}) {
  const palette = KIND_PALETTE[toast.kind];
  const Icon = palette.Icon;
  return (
    <div
      role="status"
      className={`pointer-events-auto rounded-md border ${palette.border} ${palette.bg} px-3 py-2 text-sm shadow-lg`}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${palette.icon}`}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          {toast.title && (
            <div className={`font-medium ${palette.title}`}>{toast.title}</div>
          )}
          <div className={`break-words ${palette.body}`}>{toast.message}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-1 flex h-4 w-4 items-center justify-center text-neutral-500 hover:text-neutral-200"
          aria-label="Dismiss"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const KIND_PALETTE: Record<
  ToastKind,
  {
    border: string;
    bg: string;
    icon: string;
    title: string;
    body: string;
    Icon: ComponentType<LucideProps>;
  }
> = {
  info: {
    border: 'border-neutral-700',
    bg: 'bg-neutral-900',
    icon: 'text-sky-400',
    title: 'text-neutral-100',
    body: 'text-neutral-300',
    Icon: Info,
  },
  success: {
    border: 'border-emerald-800',
    bg: 'bg-emerald-950/80',
    icon: 'text-emerald-400',
    title: 'text-emerald-100',
    body: 'text-emerald-200',
    Icon: CheckCircle2,
  },
  error: {
    border: 'border-red-800',
    bg: 'bg-red-950/80',
    icon: 'text-red-400',
    title: 'text-red-100',
    body: 'text-red-200',
    Icon: AlertTriangle,
  },
};
