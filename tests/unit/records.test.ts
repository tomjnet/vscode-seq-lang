import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  artifactPaths,
  attemptSource,
  buildFreshness,
  describeTests,
  latestExecutedRun,
  listAttempts,
  listRuns,
  projectPaths,
  projectRootOf,
  readBuild,
  readPlan,
  relativeTime,
  runTime,
  sourceHash,
  stepFunctionLines,
} from '../../src/core/records';

const root = join(__dirname, '..', 'fixtures', 'project');
const paths = projectPaths(root);
const NEW_RUN = '20261002T140203.123Z-a1b2c3';
const OLD_RUN = '20261001T090000.000Z-0f0f0f';

describe('project layout', () => {
  it('recognizes only <project>/src/main.seq as an entry point', () => {
    expect(projectRootOf(join(root, 'src', 'main.seq'))).toBe(root);
    expect(projectRootOf(join(root, 'src', 'other.seq'))).toBeUndefined();
    expect(projectRootOf(join(root, 'main.seq'))).toBeUndefined();
  });

  it('names the artifacts after the workflow', () => {
    const artifacts = artifactPaths(paths, 'numbers');
    expect(artifacts.source).toBe(join(root, 'output', 'temp', 'numbers.c'));
    expect(artifacts.testSource).toBe(join(root, 'output', 'temp', 'test', 'numbers_test.cc'));
  });
});

describe('records', () => {
  it('reads the accepted build', () => {
    const build = readBuild(paths)!;
    expect(build.workflow).toBe('numbers');
    expect(build.plan?.steps.map((s) => s.name)).toEqual(['make_numbers', 'add_numbers']);
    expect(describeTests(build)).toBe('2 tests passed');
  });

  it('returns nothing where there is no project', () => {
    const empty = projectPaths(join(root, 'input'));
    expect(readBuild(empty)).toBeUndefined();
    expect(listRuns(empty)).toEqual([]);
    expect(latestExecutedRun(empty)).toBeUndefined();
  });

  it('lists runs newest first', () => {
    expect(listRuns(paths)).toEqual([NEW_RUN, OLD_RUN]);
    expect(latestExecutedRun(paths)).toMatchObject({ id: NEW_RUN, manifest: { status: 'ok' } });
  });

  it('reads a plan', () => {
    expect(readPlan(paths, OLD_RUN)?.outputs?.map((o) => o.path)).toEqual(['numbers.txt', 'total.txt']);
  });

  it('reads the time out of a run identifier', () => {
    expect(runTime(NEW_RUN)?.toISOString()).toBe('2026-10-02T14:02:03.123Z');
    expect(runTime('not-a-run')).toBeUndefined();
  });

  it('lists the attempts of a run in order', () => {
    const attempts = listAttempts(join(paths.runs, NEW_RUN));
    expect(attempts.map((a) => a.label)).toEqual(['generate-1', 'generate-2', 'test-1']);
    expect(attemptSource(attempts[0])).toMatch(/generate-1[\\/]numbers\.c$/);
    expect(attemptSource(attempts[2])).toMatch(/test-1[\\/]numbers_test\.cc$/);
  });
});

describe('build freshness', () => {
  const source = readFileSync(paths.source, 'utf8');
  const build = readBuild(paths);

  it('matches the hash seqc recorded', () => {
    expect(buildFreshness(build, source)).toBe('current');
  });

  it('ignores a byte-order mark and CRLF, as seqc does', () => {
    expect(sourceHash('﻿' + source.replace(/\r?\n/g, '\r\n'))).toBe(sourceHash(source.replace(/\r\n/g, '\n')));
  });

  it('notices an edit', () => {
    expect(buildFreshness(build, source + '# edited\n')).toBe('changed');
  });

  it('reports a missing build', () => {
    expect(buildFreshness(undefined, source)).toBe('none');
  });
});

describe('stepFunctionLines', () => {
  it('finds the definitions, not the prototypes or the driver table', () => {
    const c = readFileSync(artifactPaths(paths, 'numbers').source, 'utf8');
    const lines = stepFunctionLines(c);
    const text = c.split(/\r?\n/);
    expect([...lines.keys()]).toEqual([1, 2]);
    expect(text[lines.get(1)!]).toBe('int seq_step_1(seq_ctx *ctx) {');
    expect(text[lines.get(2)!]).toBe('int seq_step_2(seq_ctx *ctx) {');
  });

  it('accepts a brace on the next line and a static definition', () => {
    const lines = stepFunctionLines('int seq_step_1(seq_ctx *ctx);\nstatic int seq_step_1(seq_ctx *ctx)\n{\n}\n');
    expect(lines.get(1)).toBe(1);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('describes how long ago something was', () => {
    expect(relativeTime(new Date('2026-10-02T11:59:40Z'), now)).toBe('just now');
    expect(relativeTime(new Date('2026-10-02T11:58:00Z'), now)).toBe('2 min ago');
    expect(relativeTime(new Date('2026-10-02T09:00:00Z'), now)).toBe('3 h ago');
    expect(relativeTime(new Date('2026-09-30T12:00:00Z'), now)).toBe('2 days ago');
  });
});
