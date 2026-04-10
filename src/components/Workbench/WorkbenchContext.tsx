'use client';

/**
 * Client-side state for the Workbench UI.
 *
 * Responsibilities:
 * - Fetching and caching the directory tree
 * - Tracking open files (tabs), the active tab, and per-file buffers
 * - Dirty detection (comparing current buffer against last-saved content)
 * - Exposing a shared reference to the Monaco editor instance so the
 *   YAML tree panel can scroll the editor to a clicked node
 *
 * State shape intentionally kept flat and serializable so it's easy to
 * reason about. React state + context is enough for the current feature
 * set — no need for a store library yet.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { editor } from 'monaco-editor';

import {
  ApiClientError,
  fetchFile,
  fetchTree,
  saveFile,
} from '@/lib/api-client';
import type { TreeEntry } from '@/types';

// ---------- types ----------

export interface OpenFile {
  /** POSIX-style path relative to DATA_DIR. */
  path: string;
  /** The current, possibly-unsaved editor buffer. */
  content: string;
  /** The last content we know is persisted to disk. */
  savedContent: string;
  /** True while the initial load request is in flight. */
  loading: boolean;
  /** Error string from the last read attempt, if any. */
  error: string | null;
}

interface WorkbenchState {
  // Tree
  treeEntries: TreeEntry[];
  treeLoading: boolean;
  treeError: string | null;

  // Files
  openFiles: OpenFile[];
  activePath: string | null;

  // Actions
  reloadTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveActive: () => Promise<void>;

  // Editor integration
  registerEditor: (
    editorInstance: editor.IStandaloneCodeEditor | null,
  ) => void;
  scrollToLine: (line: number) => void;
}

const WorkbenchContext = createContext<WorkbenchState | null>(null);

/** Consumer hook. Throws if used outside the provider. */
export function useWorkbench(): WorkbenchState {
  const ctx = useContext(WorkbenchContext);
  if (!ctx) {
    throw new Error('useWorkbench must be used inside WorkbenchProvider');
  }
  return ctx;
}

/** Derived helper: is the active file dirty? */
export function useActiveFile(): OpenFile | null {
  const { openFiles, activePath } = useWorkbench();
  if (activePath == null) return null;
  return openFiles.find((f) => f.path === activePath) ?? null;
}

export function isDirty(file: OpenFile): boolean {
  return file.content !== file.savedContent;
}

// ---------- provider ----------

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [treeEntries, setTreeEntries] = useState<TreeEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  // The Monaco editor instance lives in a ref — it's imperative state
  // that should never trigger re-renders.
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // ---------- tree ----------

  const reloadTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const entries = await fetchTree();
      setTreeEntries(entries);
    } catch (err) {
      setTreeError(errorMessage(err));
      setTreeEntries([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  // Load the tree once on mount.
  useEffect(() => {
    void reloadTree();
  }, [reloadTree]);

  // ---------- file operations ----------

  const openFile = useCallback(async (path: string) => {
    // If already open, just activate it.
    let alreadyOpen = false;
    setOpenFiles((prev) => {
      if (prev.some((f) => f.path === path)) {
        alreadyOpen = true;
        return prev;
      }
      return [
        ...prev,
        {
          path,
          content: '',
          savedContent: '',
          loading: true,
          error: null,
        },
      ];
    });
    setActivePath(path);
    if (alreadyOpen) return;

    try {
      const body = await fetchFile(path);
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === path
            ? {
                ...f,
                content: body.content,
                savedContent: body.content,
                loading: false,
                error: null,
              }
            : f,
        ),
      );
    } catch (err) {
      const message = errorMessage(err);
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === path ? { ...f, loading: false, error: message } : f,
        ),
      );
    }
  }, []);

  const closeFile = useCallback(
    (path: string) => {
      setOpenFiles((prev) => {
        const index = prev.findIndex((f) => f.path === path);
        if (index === -1) return prev;
        const next = prev.filter((f) => f.path !== path);

        // If we closed the active tab, move to a neighbor.
        if (activePath === path) {
          if (next.length === 0) {
            setActivePath(null);
          } else {
            const neighbor = next[Math.min(index, next.length - 1)];
            setActivePath(neighbor.path);
          }
        }
        return next;
      });
    },
    [activePath],
  );

  const setActive = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const updateContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, content } : f)),
    );
  }, []);

  const saveActive = useCallback(async () => {
    // Read the latest state via an updater so we don't close over stale
    // `openFiles` / `activePath`.
    let target: OpenFile | null = null;
    setOpenFiles((prev) => {
      target = prev.find((f) => f.path === activePath) ?? null;
      return prev;
    });
    if (!target) return;
    const { path, content } = target;

    try {
      await saveFile(path, content);
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === path ? { ...f, savedContent: content, error: null } : f,
        ),
      );
    } catch (err) {
      const message = errorMessage(err);
      setOpenFiles((prev) =>
        prev.map((f) => (f.path === path ? { ...f, error: message } : f)),
      );
    }
  }, [activePath]);

  // ---------- editor bridge ----------

  const registerEditor = useCallback(
    (editorInstance: editor.IStandaloneCodeEditor | null) => {
      editorRef.current = editorInstance;
    },
    [],
  );

  const scrollToLine = useCallback((line: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    ed.focus();
  }, []);

  const value = useMemo<WorkbenchState>(
    () => ({
      treeEntries,
      treeLoading,
      treeError,
      openFiles,
      activePath,
      reloadTree,
      openFile,
      closeFile,
      setActive,
      updateContent,
      saveActive,
      registerEditor,
      scrollToLine,
    }),
    [
      treeEntries,
      treeLoading,
      treeError,
      openFiles,
      activePath,
      reloadTree,
      openFile,
      closeFile,
      setActive,
      updateContent,
      saveActive,
      registerEditor,
      scrollToLine,
    ],
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
    </WorkbenchContext.Provider>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}
