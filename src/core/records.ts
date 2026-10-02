// Read-only access to what seqc writes under <project>/output/temp. The
// extension never writes there and never decides whether a build is valid:
// build.json exists only for an accepted, complete build.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PlanStep {
  index: number;
  name: string;
  summary?: string;
  reads?: string[];
  writes?: string[];
}

export interface Plan {
  steps: PlanStep[];
  outputs?: { path: string; kind?: string; final?: boolean }[];
  dependencies?: string[];
}

export interface BuildManifest {
  cache_key?: string;
  created?: string;
  run_id?: string;
  workflow?: string;
  seqc_version?: string;
  source_sha256?: string;
  attempts?: { program?: number; tests?: number; limit?: number };
  warnings?: string;
  plan?: Plan;
  tests?: { status?: string; passed?: number; failed?: number; cases?: { name: string; passed: boolean }[] };
}

export interface RunStep {
  index: number;
  name: string;
  /** "ok", "failed", or "running" (the program stopped inside the step). */
  status: string;
  code?: number;
  message?: string;
}

export interface RunManifest {
  run_id?: string;
  finished?: string;
  cache_key?: string;
  reused_cached_build?: boolean;
  exit_code?: number;
  seconds?: number;
  /** "ok", "step-failed", "abnormal-end", "invalid-outputs", "publish-refused", ... */
  status?: string;
  steps?: RunStep[];
  published?: { path: string; size?: number; kind?: string; final?: boolean }[];
  undeclared?: string[];
}

export interface ProjectPaths {
  root: string;
  source: string;
  input: string;
  output: string;
  temp: string;
  test: string;
  runs: string;
  lockFile: string;
  buildFile: string;
}

export function projectPaths(root: string): ProjectPaths {
  const output = path.join(root, 'output');
  const temp = path.join(output, 'temp');
  return {
    root,
    source: path.join(root, 'src', 'main.seq'),
    input: path.join(root, 'input'),
    output,
    temp,
    test: path.join(temp, 'test'),
    runs: path.join(temp, 'runs'),
    lockFile: path.join(root, 'seq.lock'),
    buildFile: path.join(temp, 'build.json'),
  };
}

/**
 * The project a source file is the entry point of. seqc builds only
 * <project>/src/main.seq; any other .seq file can be checked but not built.
 */
export function projectRootOf(sourcePath: string): string | undefined {
  if (path.basename(sourcePath) !== 'main.seq') return undefined;
  const src = path.dirname(sourcePath);
  if (path.basename(src) !== 'src') return undefined;
  return path.dirname(src);
}

export interface Artifacts {
  source: string;
  assembly: string;
  binary: string;
  testSource: string;
  testBinary: string;
}

export function artifactPaths(paths: ProjectPaths, name: string): Artifacts {
  return {
    source: path.join(paths.temp, `${name}.c`),
    assembly: path.join(paths.temp, `${name}.s`),
    binary: path.join(paths.temp, `${name}.bin`),
    testSource: path.join(paths.test, `${name}_test.cc`),
    testBinary: path.join(paths.test, `${name}_test.bin`),
  };
}

function readJson<T>(file: string): T | undefined {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

export function readBuild(paths: ProjectPaths): BuildManifest | undefined {
  return readJson<BuildManifest>(paths.buildFile);
}

export function readRunManifest(paths: ProjectPaths, runId: string): RunManifest | undefined {
  return readJson<RunManifest>(path.join(paths.runs, runId, 'run-manifest.json'));
}

export function readPlan(paths: ProjectPaths, runId: string): Plan | undefined {
  return readJson<Plan>(path.join(paths.runs, runId, 'plan.json'));
}

/** Run identifiers, newest first. They start with a UTC timestamp, so they sort by name. */
export function listRuns(paths: ProjectPaths): string[] {
  try {
    return fs
      .readdirSync(paths.runs, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export interface LatestRun {
  id: string;
  manifest: RunManifest;
}

/** The newest run that got as far as executing the program. */
export function latestExecutedRun(paths: ProjectPaths): LatestRun | undefined {
  for (const id of listRuns(paths)) {
    const manifest = readRunManifest(paths, id);
    if (manifest) return { id, manifest };
  }
  return undefined;
}

/** Parses "20261002T140203.123Z-a1b2c3" into a Date. */
export function runTime(runId: string): Date | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})Z/.exec(runId);
  if (!m) return undefined;
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The hash seqc records as source_sha256: over the source with one leading
 * byte-order mark removed and CRLF turned into LF.
 */
export function sourceHash(text: string): string {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

export type Freshness = 'none' | 'current' | 'changed';

/** Whether the accepted build was made from this source text. Inputs, model, and toolchain are not considered. */
export function buildFreshness(build: BuildManifest | undefined, sourceText: string): Freshness {
  if (!build) return 'none';
  if (!build.source_sha256) return 'current';
  return build.source_sha256 === sourceHash(sourceText) ? 'current' : 'changed';
}

/**
 * 0-based line of each `int seq_step_<N>(seq_ctx *ctx)` definition in a
 * generated C unit. Prototypes and the driver table are skipped.
 */
export function stepFunctionLines(cSource: string): Map<number, number> {
  const result = new Map<number, number>();
  const lines = cSource.split(/\r?\n/);
  const re = /^\s*(?:static\s+)?int\s+seq_step_(\d+)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (!m) continue;
    if (lines[i].trimEnd().endsWith(';')) continue;
    const index = Number(m[1]);
    if (!result.has(index)) result.set(index, i);
  }
  return result;
}

export interface Attempt {
  /** "generate-2", "test-1". */
  label: string;
  kind: 'generate' | 'test';
  number: number;
  dir: string;
}

export function parseAttemptLabel(label: string): { kind: 'generate' | 'test'; number: number } | undefined {
  const m = /^(generate|test)-(\d+)$/.exec(label);
  return m ? { kind: m[1] as 'generate' | 'test', number: Number(m[2]) } : undefined;
}

export function listAttempts(runDir: string): Attempt[] {
  const dir = path.join(runDir, 'attempts');
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const parsed = parseAttemptLabel(entry.name);
        return parsed ? [{ label: entry.name, ...parsed, dir: path.join(dir, entry.name) }] : [];
      })
      .sort((a, b) => (a.kind === b.kind ? a.number - b.number : a.kind < b.kind ? -1 : 1));
  } catch {
    return [];
  }
}

/** The file an attempt is about: <name>.c for generate-N, <name>_test.cc for test-N. */
export function attemptSource(attempt: Pick<Attempt, 'kind' | 'dir'>): string | undefined {
  try {
    const names = fs.readdirSync(attempt.dir);
    const wanted = attempt.kind === 'generate' ? names.find((n) => n.endsWith('.c')) : names.find((n) => n.endsWith('_test.cc'));
    return wanted ? path.join(attempt.dir, wanted) : undefined;
  } catch {
    return undefined;
  }
}

export function describeTests(build: BuildManifest): string | undefined {
  const tests = build.tests;
  if (!tests || typeof tests.passed !== 'number') return undefined;
  const failed = tests.failed ?? 0;
  return failed > 0 ? `${tests.passed} passed, ${failed} failed` : `${tests.passed} test${tests.passed === 1 ? '' : 's'} passed`;
}

export function relativeTime(then: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
