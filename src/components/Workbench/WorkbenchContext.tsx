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
  renameEntry,
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

  // Saves in flight. Stable across renders; `isSaving(path)` is the
  // read side, `savePath(path)` / `saveActive()` are the write sides.
  // Both funnel through the same internal routine so two concurrent
  // triggers of the same file (e.g. Cmd+S racing a button click)
  // can't double-PUT.
  savingPaths: ReadonlySet<string>;
  isSaving: (path: string) => boolean;

  // Actions
  reloadTree: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeFile: (path: string) => void;
  /**
   * Ask to close a file. If the file is dirty, sets `pendingClose` so
   * the shell can pop a confirmation dialog. If it's clean, closes
   * immediately.
   */
  requestCloseFile: (path: string) => void;
  setActive: (path: string) => void;
  updateContent: (path: string, content: string) => void;
  /**
   * Save a specific open file. No-op if the path isn't open, is clean,
   * or already has a save in flight. Throws on I/O failure (after
   * surfacing the error on the file entry).
   */
  savePath: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  /** Shortcut: request close of the currently active tab. */
  closeActive: () => void;

  // Unsaved-changes confirm flow
  pendingClosePath: string | null;
  confirmPendingClose: () => void;
  cancelPendingClose: () => void;

  // Filesystem mutations (reload the tree on success).
  createFile: (path: string, content?: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  /**
   * Rename (move) a file or directory. Any open tabs whose path is the
   * renamed entry — or lives inside a renamed directory — are remapped
   * to the new path so the user's edits stay attached to the right
   * buffer.
   */
  renamePath: (sourcePath: string, destinationPath: string) => Promise<void>;
  copyTemplateToData: (body: CopyTemplateRequest) => Promise<void>;

  // Editor integration
  registerEditor: (
    editorInstance: editor.IStandaloneCodeEditor | null,
  ) => void;
  scrollToLine: (line: number) => void;
}

const LAYOUT_STORAGE_KEY = 'traefik-workbench:layout';
const SESSION_STORAGE_KEY = 'traefik-workbench:session';
const SESSION_SAVE_DEBOUNCE_MS = 300;

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

/**
 * On-disk shape of the persisted editor session. We snapshot just
 * enough to rehydrate the open tabs and active selection — transient
 * fields like `loading` / `error` are omitted because they only
 * describe an in-flight request that no longer exists after a reload.
 *
 * Stored in localStorage so it survives both hard reloads and
 * client-side navigation away from the workbench (e.g. /settings),
 * since the WorkbenchProvider is unmounted on route change.
 */
interface PersistedSession {
  openFiles: Array<{ path: string; content: string; savedContent: string }>;
  activePath: string | null;
}

function readPersistedSession(): PersistedSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as PersistedSession).openFiles)
    ) {
      return null;
    }
    const candidate = parsed as PersistedSession;
    // Defensive shape validation: drop any entry that doesn't look like
    // an OpenFile snapshot. A corrupt entry would otherwise wedge the
    // editor by giving Monaco an undefined model value.
    const openFiles = candidate.openFiles.filter(
      (f): f is { path: string; content: string; savedContent: string } =>
        !!f &&
        typeof f === 'object' &&
        typeof (f as { path?: unknown }).path === 'string' &&
        typeof (f as { content?: unknown }).content === 'string' &&
        typeof (f as { savedContent?: unknown }).savedContent === 'string',
    );
    const activePath =
      typeof candidate.activePath === 'string' ? candidate.activePath : null;
    return { openFiles, activePath };
  } catch {
    return null;
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

/**
 * Returns a flat list of every YAML file path in the workspace tree.
 * Used by the AI layer to send the workspace path catalog to Claude
 * (so it can spot references to files that don't exist) without having
 * to subscribe to the entire tree shape.
 */
export function useWorkspaceFilePaths(): string[] {
  const { treeEntries } = useWorkbench();
  return useMemo(() => {
    const paths: string[] = [];
    const walk = (entries: TreeEntry[]) => {
      for (const entry of entries) {
        if (entry.kind === 'file' && isYamlPath(entry.path)) {
          paths.push(entry.path);
        }
        if (entry.kind === 'directory' && entry.children) {
          walk(entry.children);
        }
      }
    };
    walk(treeEntries);
    paths.sort();
    return paths;
  }, [treeEntries]);
}

function isYamlPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.yml') || lower.endsWith('.yaml');
}

export function isDirty(file: OpenFile): boolean {
  return file.content !== file.savedContent;
}

// ---------- provider ----------

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [treeEntries, setTreeEntries] = useState<TreeEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState<boolean>(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  // Hydrate openFiles + activePath from localStorage on first render so
  // navigating to /settings and back (or a hard reload) doesn't lose
  // unsaved buffers. We do this in the lazy initializer so the very
  // first paint already has the rehydrated state — no flash of empty
  // tabs followed by an effect-driven restore.
  const [openFiles, setOpenFiles] = useState<OpenFile[]>(() => {
    const persisted = readPersistedSession();
    if (!persisted) return [];
    return persisted.openFiles.map((f) => ({
      path: f.path,
      content: f.content,
      savedContent: f.savedContent,
      loading: false,
      error: null,
    }));
  });
  const [activePath, setActivePath] = useState<string | null>(() => {
    const persisted = readPersistedSession();
    if (!persisted) return null;
    // Only honor activePath if the file is actually in the rehydrated
    // tab list — otherwise we'd point at a ghost.
    if (
      persisted.activePath &&
      persisted.openFiles.some((f) => f.path === persisted.activePath)
    ) {
      return persisted.activePath;
    }
    return persisted.openFiles[0]?.path ?? null;
  });
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(
    null,
  );
  const [savingPaths, setSavingPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // Synchronous mirror of `savingPaths`. State updates are batched, so
  // two back-to-back `savePath(p)` calls in the same tick would both
  // read `savingPaths.has(p) === false` and race. The ref is updated
  // inside the setter callback and consulted by the guard below.
  const savingPathsRef = useRef<Set<string>>(new Set());

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

  // Persist the editor session (open tabs + active selection + buffer
  // contents) so the workbench survives navigation to /settings and
  // back without losing unsaved edits. Debounced because every
  // keystroke updates `openFiles` and we don't want to thrash
  // localStorage on each keypress. Loading entries are skipped — we
  // don't want to checkpoint a half-fetched empty buffer that would
  // shadow the real file on rehydration.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handle = setTimeout(() => {
      const payload: PersistedSession = {
        openFiles: openFiles
          .filter((f) => !f.loading)
          .map((f) => ({
            path: f.path,
            content: f.content,
            savedContent: f.savedContent,
          })),
        activePath,
      };
      try {
        window.localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(payload),
        );
      } catch {
        // Quota exceeded / private mode — drop the snapshot. The user
        // will lose their session on the next reload but the live tab
        // keeps working.
      }
    }, SESSION_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [openFiles, activePath]);

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

  const requestCloseFile = useCallback(
    (path: string) => {
      // Read the latest open-files snapshot via an updater so this
      // doesn't close over stale state (Cmd+W bound in Monaco captures
      // the callback at mount time).
      let dirty = false;
      setOpenFiles((prev) => {
        const file = prev.find((f) => f.path === path);
        if (file && file.content !== file.savedContent) dirty = true;
        return prev;
      });
      if (dirty) {
        setPendingClosePath(path);
      } else {
        closeFile(path);
      }
    },
    [closeFile],
  );

  const confirmPendingClose = useCallback(() => {
    const target = pendingClosePath;
    if (target == null) return;
    setPendingClosePath(null);
    closeFile(target);
  }, [pendingClosePath, closeFile]);

  const cancelPendingClose = useCallback(() => {
    setPendingClosePath(null);
  }, []);

  // beforeunload guard: if any open file is dirty, browsers will show
  // their stock "Leave site?" prompt. The exact text is hard-coded by
  // the browser for modern versions; we just need to set returnValue.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const anyDirty = openFiles.some(
        (f) => f.content !== f.savedContent,
      );
      if (anyDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [openFiles]);

  const setActive = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const updateContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => (f.path === path ? { ...f, content } : f)),
    );
  }, []);

  const isSaving = useCallback(
    (path: string) => savingPaths.has(path),
    [savingPaths],
  );

  /**
   * The one and only path that actually hits the API. Guards against a
   * second concurrent save of the same file, captures the buffer
   * contents under the snapshot pattern, and clears the saving flag in
   * `finally` so an exception can't leave a file permanently "saving".
   *
   * Re-throws after recording the error on the file entry so callers
   * (e.g. the keybind handler) can surface a toast.
   */
  const savePath = useCallback(async (path: string): Promise<void> => {
    // Synchronous double-save guard.
    if (savingPathsRef.current.has(path)) return;

    // Resolve the target via a snapshot updater so we always see the
    // latest buffer even if the caller closes over stale state.
    let snapshot: OpenFile | null = null;
    setOpenFiles((prev) => {
      snapshot = prev.find((f) => f.path === path) ?? null;
      return prev;
    });
    // Cast through `as` because TypeScript can't track assignments
    // made inside a setState callback across closure boundaries —
    // it's still `OpenFile | null` by the same logic that the
    // original `saveActive` relied on.
    const target = snapshot as OpenFile | null;
    if (!target) return;
    // Nothing to do for a clean buffer — skip the network round-trip.
    if (target.content === target.savedContent) return;
    const { content } = target;

    savingPathsRef.current.add(path);
    setSavingPaths((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });

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
    } finally {
      savingPathsRef.current.delete(path);
      setSavingPaths((prev) => {
        if (!prev.has(path)) return prev;
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  const saveActive = useCallback(async () => {
    if (activePath == null) return;
    await savePath(activePath);
  }, [activePath, savePath]);

  const closeActive = useCallback(() => {
    if (activePath != null) requestCloseFile(activePath);
  }, [activePath, requestCloseFile]);

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

  const renamePath = useCallback(
    async (sourcePath: string, destinationPath: string) => {
      if (sourcePath === destinationPath) return;

      // Refuse to rename a file (or any file inside a directory) that
      // currently has a save in flight — the PUT would either land on
      // the old path and then disappear, or race the rename on the
      // server. Callers are expected to disable the rename affordance
      // based on `savingPaths`; this is a belt-and-braces check.
      const srcPrefix = sourcePath.endsWith('/')
        ? sourcePath
        : `${sourcePath}/`;
      for (const p of savingPathsRef.current) {
        if (p === sourcePath || p.startsWith(srcPrefix)) {
          throw new Error(
            'Cannot rename while a save is in progress. Please try again in a moment.',
          );
        }
      }

      await renameEntry(sourcePath, destinationPath);

      // Remap any open tabs that lived at (or under) the renamed path.
      // `srcPrefix` was already computed above for the saving-check.
      const dstPrefix = destinationPath.endsWith('/')
        ? destinationPath
        : `${destinationPath}/`;
      const remap = (p: string): string | null => {
        if (p === sourcePath) return destinationPath;
        if (p.startsWith(srcPrefix)) return dstPrefix + p.slice(srcPrefix.length);
        return null;
      };

      setOpenFiles((prev) =>
        prev.map((f) => {
          const next = remap(f.path);
          return next == null ? f : { ...f, path: next };
        }),
      );
      setActivePath((prev) => (prev == null ? prev : (remap(prev) ?? prev)));

      await reloadTree();
    },
    [reloadTree],
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
      savingPaths,
      isSaving,
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
      requestCloseFile,
      setActive,
      updateContent,
      savePath,
      saveActive,
      closeActive,
      pendingClosePath,
      confirmPendingClose,
      cancelPendingClose,
      createFile,
      createDirectory,
      deletePath,
      renamePath,
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
      savingPaths,
      isSaving,
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
      requestCloseFile,
      setActive,
      updateContent,
      savePath,
      saveActive,
      closeActive,
      pendingClosePath,
      confirmPendingClose,
      cancelPendingClose,
      createFile,
      createDirectory,
      deletePath,
      renamePath,
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
