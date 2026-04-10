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
  copyTemplate,
  createEntry,
  deleteEntry,
  fetchFile,
  fetchTree,
  saveFile,
} from '@/lib/api-client';
import type { CopyTemplateRequest, TreeEntry } from '@/types';

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

  // Layout
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (px: number) => void;
  setRightWidth: (px: number) => void;
  resetLeftWidth: () => void;
  resetRightWidth: () => void;

  // Actions
  reloadTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  saveActive: () => Promise<void>;
  saveAll: () => Promise<{ saved: number; failed: number }>;
  closeActive: () => void;

  // Filesystem mutations (reload the tree on success).
  createFile: (path: string, content?: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  copyTemplateToData: (body: CopyTemplateRequest) => Promise<void>;

  // Editor integration
  registerEditor: (
    editorInstance: editor.IStandaloneCodeEditor | null,
  ) => void;
  scrollToLine: (line: number) => void;
}

const LAYOUT_STORAGE_KEY = 'traefik-workbench:layout';

/** Default and clamp ranges for side-pane widths (pixels). */
export const LAYOUT_DEFAULTS = {
  leftWidth: 256,
  rightWidth: 320,
  minLeftWidth: 160,
  maxLeftWidth: 560,
  minRightWidth: 200,
  maxRightWidth: 640,
} as const;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

interface PersistedLayout {
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  leftWidth?: number;
  rightWidth?: number;
}

function readPersistedLayout(): PersistedLayout {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as PersistedLayout;
  } catch {
    return {};
  }
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

  // Layout state. Initialized to defaults so SSR and the first client
  // render agree (no hydration mismatch), then rehydrated from
  // localStorage in an effect below.
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(false);
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(false);
  const [leftWidth, setLeftWidthState] = useState<number>(
    LAYOUT_DEFAULTS.leftWidth,
  );
  const [rightWidth, setRightWidthState] = useState<number>(
    LAYOUT_DEFAULTS.rightWidth,
  );

  useEffect(() => {
    const persisted = readPersistedLayout();
    if (persisted.leftCollapsed) setLeftCollapsed(true);
    if (persisted.rightCollapsed) setRightCollapsed(true);
    if (typeof persisted.leftWidth === 'number') {
      setLeftWidthState(
        clamp(
          persisted.leftWidth,
          LAYOUT_DEFAULTS.minLeftWidth,
          LAYOUT_DEFAULTS.maxLeftWidth,
        ),
      );
    }
    if (typeof persisted.rightWidth === 'number') {
      setRightWidthState(
        clamp(
          persisted.rightWidth,
          LAYOUT_DEFAULTS.minRightWidth,
          LAYOUT_DEFAULTS.maxRightWidth,
        ),
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload: PersistedLayout = {
      leftCollapsed,
      rightCollapsed,
      leftWidth,
      rightWidth,
    };
    try {
      window.localStorage.setItem(
        LAYOUT_STORAGE_KEY,
        JSON.stringify(payload),
      );
    } catch {
      // Ignore quota / private-mode errors — layout is a nice-to-have.
    }
  }, [leftCollapsed, rightCollapsed, leftWidth, rightWidth]);

  const toggleLeft = useCallback(() => setLeftCollapsed((v) => !v), []);
  const toggleRight = useCallback(() => setRightCollapsed((v) => !v), []);

  const setLeftWidth = useCallback((px: number) => {
    setLeftWidthState(
      clamp(
        px,
        LAYOUT_DEFAULTS.minLeftWidth,
        LAYOUT_DEFAULTS.maxLeftWidth,
      ),
    );
  }, []);
  const setRightWidth = useCallback((px: number) => {
    setRightWidthState(
      clamp(
        px,
        LAYOUT_DEFAULTS.minRightWidth,
        LAYOUT_DEFAULTS.maxRightWidth,
      ),
    );
  }, []);
  const resetLeftWidth = useCallback(
    () => setLeftWidthState(LAYOUT_DEFAULTS.leftWidth),
    [],
  );
  const resetRightWidth = useCallback(
    () => setRightWidthState(LAYOUT_DEFAULTS.rightWidth),
    [],
  );

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
      throw err;
    }
  }, [activePath]);

  const saveAll = useCallback(async () => {
    // Snapshot the current open files so we know which ones were dirty
    // at the moment of the request.
    let snapshot: OpenFile[] = [];
    setOpenFiles((prev) => {
      snapshot = prev;
      return prev;
    });
    const dirty = snapshot.filter((f) => f.content !== f.savedContent);

    let saved = 0;
    let failed = 0;
    for (const file of dirty) {
      try {
        await saveFile(file.path, file.content);
        saved++;
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === file.path
              ? { ...f, savedContent: file.content, error: null }
              : f,
          ),
        );
      } catch (err) {
        failed++;
        const message = errorMessage(err);
        setOpenFiles((prev) =>
          prev.map((f) =>
            f.path === file.path ? { ...f, error: message } : f,
          ),
        );
      }
    }
    return { saved, failed };
  }, []);

  const closeActive = useCallback(() => {
    if (activePath != null) closeFile(activePath);
  }, [activePath, closeFile]);

  // ---------- filesystem mutations ----------

  const createFile = useCallback(
    async (path: string, content: string = '') => {
      await createEntry(path, { type: 'file', content });
      await reloadTree();
      // Auto-open the new file as a tab.
      await openFile(path);
    },
    [reloadTree, openFile],
  );

  const createDirectory = useCallback(
    async (path: string) => {
      await createEntry(path, { type: 'directory' });
      await reloadTree();
    },
    [reloadTree],
  );

  const deletePath = useCallback(
    async (path: string) => {
      await deleteEntry(path);
      // Close any tabs whose path is the deleted path itself or lives
      // inside a deleted directory.
      const prefix = path.endsWith('/') ? path : `${path}/`;
      setOpenFiles((prev) => {
        const next = prev.filter(
          (f) => f.path !== path && !f.path.startsWith(prefix),
        );
        if (next.length !== prev.length && activePath != null) {
          const stillOpen = next.some((f) => f.path === activePath);
          if (!stillOpen) {
            setActivePath(next.length > 0 ? next[0].path : null);
          }
        }
        return next;
      });
      await reloadTree();
    },
    [reloadTree, activePath],
  );

  const copyTemplateToData = useCallback(
    async (body: CopyTemplateRequest) => {
      await copyTemplate(body);
      await reloadTree();
      // Auto-open the newly copied file.
      await openFile(body.destinationPath);
    },
    [reloadTree, openFile],
  );

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
      leftCollapsed,
      rightCollapsed,
      toggleLeft,
      toggleRight,
      leftWidth,
      rightWidth,
      setLeftWidth,
      setRightWidth,
      resetLeftWidth,
      resetRightWidth,
      reloadTree,
      openFile,
      closeFile,
      setActive,
      updateContent,
      saveActive,
      saveAll,
      closeActive,
      createFile,
      createDirectory,
      deletePath,
      copyTemplateToData,
      registerEditor,
      scrollToLine,
    }),
    [
      treeEntries,
      treeLoading,
      treeError,
      openFiles,
      activePath,
      leftCollapsed,
      rightCollapsed,
      toggleLeft,
      toggleRight,
      leftWidth,
      rightWidth,
      setLeftWidth,
      setRightWidth,
      resetLeftWidth,
      resetRightWidth,
      reloadTree,
      openFile,
      closeFile,
      setActive,
      updateContent,
      saveActive,
      saveAll,
      closeActive,
      createFile,
      createDirectory,
      deletePath,
      copyTemplateToData,
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
