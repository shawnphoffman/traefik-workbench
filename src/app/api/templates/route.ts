/**
 * Templates API.
 *
 * GET  /api/templates   → list available YAML template files (recursive)
 * POST /api/templates   → copy a template to a destination under DATA_DIR
 *
 * Templates live in TEMPLATES_DIR (a separate mount from DATA_DIR). Only
 * YAML files are listed. Both the source (template) path and the
 * destination (data) path are sanitized against their respective roots
 * before any filesystem call.
 */

import type { NextRequest } from 'next/server';

import {
  resolveDataPath,
  resolveTemplatePath,
  TEMPLATES_DIR,
  TEMPLATES_READONLY,
} from '@/lib/paths';
import { listTemplateFiles, copyFile } from '@/lib/fs';
import { errorResponse, jsonError } from '@/lib/api-errors';
import type {
  CopyTemplateRequest,
  TemplateEntry,
  TemplatesIndexResponse,
} from '@/types';

export async function GET() {
  try {
    const entries: TemplateEntry[] = await listTemplateFiles(TEMPLATES_DIR);
    const body: TemplatesIndexResponse = {
      entries,
      writable: !TEMPLATES_READONLY,
    };
    return Response.json(body);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  let body: CopyTemplateRequest;
  try {
    body = (await request.json()) as CopyTemplateRequest;
  } catch {
    return jsonError(400, 'Invalid JSON body');
  }
  if (
    !body ||
    typeof body.templatePath !== 'string' ||
    typeof body.destinationPath !== 'string'
  ) {
    return jsonError(
      400,
      '`templatePath` and `destinationPath` must be strings',
    );
  }

  const sourceAbs = resolveTemplatePath(body.templatePath);
  if (sourceAbs === null) {
    return jsonError(400, 'Invalid template path');
  }
  const destinationAbs = resolveDataPath(body.destinationPath);
  if (destinationAbs === null) {
    return jsonError(400, 'Invalid destination path');
  }

  try {
    await copyFile(sourceAbs, destinationAbs);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
