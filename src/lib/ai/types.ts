/**
 * Shared AI types — request/response shapes for the /api/ai/* routes.
 * Safe to import from server or client.
 */

export type TraefikConfigType = 'static' | 'dynamic' | 'unknown';

/** A workspace YAML file path (relative to DATA_DIR). */
export interface WorkspaceFileRef {
  path: string;
}

/** A workspace YAML file with content. Used for "related" context. */
export interface WorkspaceFileWithContent {
  path: string;
  content: string;
}

// ---------- /api/ai/status ----------

export interface AiStatusResponse {
  enabled: boolean;
  model: string;
  features: {
    completion: boolean;
    validation: boolean;
    format: boolean;
  };
  apiKeySource: 'file' | 'env' | 'none';
}

// ---------- /api/ai/complete ----------

export interface CompleteRequest {
  activePath: string;
  beforeCursor: string;
  afterCursor: string;
  workspacePaths: string[];
}

export interface CompletionItem {
  label: string;
  insertText: string;
  detail?: string;
  documentation?: string;
}

export interface CompleteResponse {
  enabled: true;
  items: CompletionItem[];
}

export interface CompleteDisabledResponse {
  enabled: false;
}

// ---------- /api/ai/validate ----------

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  source: 'claude';
}

export interface ValidateRequest {
  activePath: string;
  content: string;
  workspacePaths: string[];
}

export interface ValidateResponse {
  enabled: true;
  diagnostics: Diagnostic[];
}

export interface ValidateDisabledResponse {
  enabled: false;
}

// ---------- /api/ai/format ----------

export interface FormatRequest {
  activePath: string;
  content: string;
}

export interface FormatResponse {
  enabled: true;
  formatted: string;
}

export interface FormatDisabledResponse {
  enabled: false;
}

// ---------- shared error envelope ----------

export interface AiErrorResponse {
  enabled: true;
  error: string;
}
