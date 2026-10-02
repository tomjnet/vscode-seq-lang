import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commentStart, decodeString, findString, isIdentifier, parseOutline } from '../../src/core/document';

const fixtures = join(__dirname, '..', 'fixtures');

describe('parseOutline', () => {
  it('reads the reference shape', () => {
    const outline = parseOutline(readFileSync(join(fixtures, 'project', 'src', 'main.seq'), 'utf8'));
    expect(outline.headers.map((h) => [h.kind, h.value])).toEqual([
      ['model', 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct'],
      ['backend', 'C'],
      ['name', 'numbers'],
    ]);
    expect(outline.steps.map((s) => [s.index, s.name, s.asks.length, s.keyword.line, s.endLine])).toEqual([
      [1, 'make_numbers', 1, 5, 6],
      [2, 'add_numbers', 2, 8, 10],
    ]);
  });

  it('handles comments, escapes, and headers in any order', () => {
    const text = readFileSync(join(fixtures, 'seqc', 'comments_and_escapes.seq'), 'utf8');
    const outline = parseOutline(text);
    expect(outline.headers.map((h) => h.kind)).toEqual(['name', 'backend', 'model']);
    const [greet, finish] = outline.steps;
    expect(greet.name).toBe('greet');
    expect(greet.asks[0].request?.value).toBe('print "hello" and a backslash \\ then\na second line\twith a tab');
    expect(greet.asks[1].request?.value).toContain('a # inside a string is not a comment');
    expect(finish.asks).toHaveLength(1);
  });

  it('gives the spans the editor needs', () => {
    const outline = parseOutline('step  go():\n    ask("hi")  # note\n');
    const step = outline.steps[0];
    expect(step.nameSpan).toEqual({ line: 0, start: 6, end: 8 });
    expect(step.asks[0].keyword).toEqual({ line: 1, start: 4, end: 7 });
    expect(step.asks[0].request).toMatchObject({ line: 1, start: 8, end: 12, raw: 'hi', terminated: true });
  });

  it('is tolerant of broken input', () => {
    const outline = parseOutline('step\nstep ok():\n  ask "x"\n    ask(\n    ask("open\nmodel = 3\n');
    expect(outline.steps.map((s) => s.name)).toEqual(['', 'ok']);
    expect(outline.steps[1].asks).toHaveLength(3);
    expect(outline.steps[1].asks[1].request).toBeUndefined();
    expect(outline.steps[1].asks[2].request).toMatchObject({ raw: 'open', terminated: false });
    expect(outline.headers[0]).toMatchObject({ kind: 'model', value: undefined });
  });

  it('accepts CRLF line endings', () => {
    const outline = parseOutline('name = "a"\r\nstep s():\r\n    ask("x")\r\n');
    expect(outline.steps[0].asks[0].request?.value).toBe('x');
  });

  it('does not attach an ask to a step after a header line', () => {
    const outline = parseOutline('step a():\n    ask("1")\nname = "x"\n    ask("2")\n');
    expect(outline.steps[0].asks).toHaveLength(1);
  });
});

describe('strings and comments', () => {
  it('decodes the four escapes', () => {
    expect(decodeString('a\\"b\\\\c\\nd\\te')).toBe('a"b\\c\nd\te');
  });

  it('finds where a comment starts', () => {
    expect(commentStart('ask("a # b") # c')).toBe(13);
    expect(commentStart('ask("a \\" # b")')).toBe(-1);
    expect(commentStart('# whole line')).toBe(0);
  });

  it('finds strings', () => {
    expect(findString('x "a" "b"', 0, 5)).toMatchObject({ start: 6, end: 9, raw: 'b' });
    expect(findString('no string', 0, 0)).toBeUndefined();
  });

  it('recognizes identifiers', () => {
    expect(isIdentifier('step_1')).toBe(true);
    expect(isIdentifier('1step')).toBe(false);
    expect(isIdentifier('a-b')).toBe(false);
  });
});
