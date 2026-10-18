#!/usr/bin/env node
// scripts/qa/make-fixtures.mjs
//
// Build valid synthetic ROOT session fixtures for the isolated QA home.
//
// Why: the real DSH home's session store is dominated by subagent sessions, and the
// web UI filters those out; the frozen fixture therefore exposes only a handful of
// root sessions (~7). TEST-PLAN E2E step 4 needs "10 sessions across 3 workspaces".
//
// This script clones ONE real root session directory and rewrites the session id
// inside the zstd-compressed v4 JSONL header (the host validates id <-> directory
// consistency, so a raw file copy would break the whole workspace list), then
// registers the synthetic ids in the COPIED workspace.json. Only the disposable
// `.spike-homes/qa` home is written; the real home is read-only.
//
// Usage (called by scripts/qa/common.ps1 Add-QaFixtureRootSessions):
//   node scripts/qa/make-fixtures.mjs --workspace-json <path> --sessions-root <dir> \
//        --extra-per-workspace 4
// Prints one JSON line: { added, registryWorkspaces, template, templateId, syntheticIds }
//
// Node >= 22.15/24 provides zlib.zstdDecompressSync / zstdCompressSync.

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync, statSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

function parseArgs(argv) {
  const args = { workspaceJson: null, sessionsRoot: null, extraPerWorkspace: 4 };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = () => argv[++i];
    if (key === '--workspace-json') args.workspaceJson = next();
    else if (key === '--sessions-root') args.sessionsRoot = next();
    else if (key === '--extra-per-workspace') args.extraPerWorkspace = Number(next());
    else throw new Error(`unknown argument: ${key}`);
  }
  if (!args.workspaceJson || !args.sessionsRoot) throw new Error('--workspace-json and --sessions-root are required');
  return args;
}

/** Encode a workspace path the way DSH names its sessions directory. */
function encodeWorkspaceDir(path) {
  const encoded = String(path).trim().replace(/^([A-Za-z]):/, '$1').replace(/[\\/]/g, '-');
  return `--${encoded}--`;
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function decompressIfZstd(buffer) {
  if (buffer.length >= 4 && buffer[0] === 0x28 && buffer[1] === 0xb5 && buffer[2] === 0x2f && buffer[3] === 0xfd) {
    return zlib.zstdDecompressSync(buffer).toString('utf8');
  }
  return null;
}

function compressZstd(text) {
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'));
}

const args = parseArgs(process.argv);
const doc = JSON.parse(readFileSync(args.workspaceJson, 'utf8'));
const workspaces = doc?.tables?.workspaces;
if (!workspaces) {
  console.log(JSON.stringify({ added: 0, registryWorkspaces: [], template: null, templateId: null, syntheticIds: [] }));
  process.exit(0);
}

// 1. Pick the smallest real registered ROOT session dir as the template.
// Prefer a NON-BLANK root session as the template: blank sessions are filtered by
// the UI unless they are the current one, so cloning a blank template would produce
// invisible fixtures. Blank-ness comes from the projection cache metadata.
const projCacheSessionsDir = join(args.sessionsRoot, '..', 'storages', 'session_projcache', 'sessions');
function isBlankSession(sessionId) {
  try {
    const cache = JSON.parse(readFileSync(join(projCacheSessionsDir, `${sessionId}.json`), 'utf8'));
    const blank = cache?.record?.rows?.sessionListMetadata?.val?.blank;
    return blank === true;
  } catch {
    return true; // unknown -> treat as blank and skip
  }
}
let templateDir = null;
let templateId = null;
let templateWorkspace = null;
let templateSize = Number.MAX_SAFE_INTEGER;
for (const workspace of Object.values(workspaces)) {
  if (!workspace?.path) continue;
  const dir = join(args.sessionsRoot, encodeWorkspaceDir(workspace.path));
  if (!existsSync(dir)) continue;
  for (const sessionId of workspace.sessionIds ?? []) {
    if (isBlankSession(sessionId)) continue;
    const candidate = join(dir, sessionId);
    if (!existsSync(candidate)) continue;
    let size = 0;
    for (const file of listFiles(candidate)) size += statSync(file).size;
    if (size === 0) continue;
    if (size < templateSize) { templateSize = size; templateDir = candidate; templateId = String(sessionId); templateWorkspace = workspace; }
  }
}
if (!templateDir) {
  console.log(JSON.stringify({ added: 0, registryWorkspaces: [], template: null, templateId: null, syntheticIds: [] }));
  process.exit(0);
}

// Pre-read the template files once (decompress the zstd ones to text).
const templateFiles = listFiles(templateDir).map((file) => {
  const relative = file.slice(templateDir.length + 1);
  const buffer = readFileSync(file);
  const inflated = decompressIfZstd(buffer);
  return { relative, buffer, inflated, mtime: statSync(file).mtime };
});

// Synthetic clones stay in the TEMPLATE's own workspace: the host validates the
// session identity cwd against the workspace path, so cross-workspace clones would
// break the whole workspace/session list.
const templateWorkspaceDir = join(args.sessionsRoot, encodeWorkspaceDir(templateWorkspace.path));
const projCacheDir = join(args.sessionsRoot, '..', 'storages', 'session_projcache', 'sessions');
const templateCachePath = join(projCacheDir, `${templateId}.json`);
let templateCacheText = null;
if (existsSync(templateCachePath)) templateCacheText = readFileSync(templateCachePath, 'utf8');

let index = 0;
const syntheticIds = [];
if (!Array.isArray(templateWorkspace.sessionIds)) templateWorkspace.sessionIds = [];
for (let n = 0; n < args.extraPerWorkspace; n += 1) {
  index += 1;
  const syntheticId = `session-00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  if (templateWorkspace.sessionIds.includes(syntheticId)) continue;
  const destination = join(templateWorkspaceDir, syntheticId);
  mkdirSync(destination, { recursive: true });
  for (const file of templateFiles) {
    const targetPath = join(destination, file.relative);
    mkdirSync(join(destination, file.relative, '..'), { recursive: true });
    if (file.inflated !== null) {
      const rewritten = file.inflated.split(templateId).join(syntheticId);
      writeFileSync(targetPath, compressZstd(rewritten));
    } else {
      copyFileSync(join(templateDir, file.relative), targetPath);
    }
    utimesSync(targetPath, file.mtime, file.mtime);
  }
  if (templateCacheText !== null) {
    writeFileSync(join(projCacheDir, `${syntheticId}.json`), templateCacheText.split(templateId).join(syntheticId), 'utf8');
  }
  templateWorkspace.sessionIds.push(syntheticId);
  syntheticIds.push(syntheticId);
}
const registryWorkspaces = [templateWorkspace.workspaceId ?? templateWorkspace.title ?? null];

writeFileSync(args.workspaceJson, JSON.stringify(doc, null, 2), 'utf8');
console.log(JSON.stringify({
  added: syntheticIds.length,
  registryWorkspaces,
  template: templateDir,
  templateId,
  syntheticIds,
}, null, 0));


