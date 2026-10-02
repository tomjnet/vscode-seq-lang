import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LineSplitter,
  columnToOffset,
  parseDiagnostics,
  parseFailure,
  parseStageLine,
  tokenEnd,
} from '../../src/core/seqcOutput';

const fixtures = join(__dirname, '..', 'fixtures', 'seqc');

describe('parseDiagnostics', () => {
  // Captured from `seqc check several_errors.seq` (seqc 0.1.0).
  const stderr = readFileSync(join(fixtures, 'several_errors.stderr'), 'utf8');
  const diagnostics = parseDiagnostics(stderr);

  it('finds every error seqc reported', () => {
    expect(diagnostics.map((d) => `${d.line}:${d.column} ${d.code}`)).toEqual([
      '1:7 E0311',
      '2:9 E0203',
      '3:8 E0312',
      '5:6 E0208',
      '9:3 E0108',
      '11:6 E0315',
      '12:9 E0204',
      '13:9 E0316',
    ]);
  });

  it('keeps the message and the hint apart', () => {
    expect(diagnostics[6]).toMatchObject({
      path: 'several_errors.seq',
      severity: 'error',
      message: 'ask requires parentheses',
      hint: 'write ask("...")',
    });
  });

  it('leaves the hint out when seqc gave none', () => {
    expect(diagnostics[7].message).toBe('ask() prompt must not be empty');
    expect(diagnostics[7].hint).toBeUndefined();
  });

  it('does not take the summary line for a diagnostic', () => {
    expect(parseDiagnostics('seqc: 8 error(s) in several_errors.seq\n')).toEqual([]);
  });

  it('reads Windows paths and CRLF output', () => {
    const [d] = parseDiagnostics('C:\\work\\src\\main.seq:3:5: error[E0103]: tabs are not allowed\r\n    \tx\r\n    ^\r\n');
    expect(d).toMatchObject({ path: 'C:\\work\\src\\main.seq', line: 3, column: 5, code: 'E0103' });
  });

  it('strips color codes', () => {
    const colored = '\u001b[1mmain.seq:1:1: \u001b[0m\u001b[1;31merror[E0301]\u001b[0m\u001b[1m: missing model declaration\u001b[0m\n';
    expect(parseDiagnostics(colored)[0]).toMatchObject({ code: 'E0301', message: 'missing model declaration' });
  });

  it('does not mistake a source line that reads like a hint for the hint', () => {
    const output = ['a.seq:2:5: error[E0212]: only ask() statements are allowed in a step', '        hint: x', '        ^', ''].join('\n');
    expect(parseDiagnostics(output)[0].hint).toBeUndefined();
  });

  it('accepts a diagnostic without a source excerpt', () => {
    const output = 'a.seq:1:1: error[E0110]: cannot read a.seq\n    hint: check the permissions\n';
    expect(parseDiagnostics(output)[0].hint).toBe('check the permissions');
  });
});

describe('columnToOffset', () => {
  it('counts code points, not UTF-16 units', () => {
    const line = '    ask("😀 ok" x)';
    // Column 14 is the character after the closing quote when 😀 counts as one.
    expect(line[columnToOffset(line, 14)]).toBe('"');
    expect(columnToOffset(line, 1)).toBe(0);
  });

  it('stops at the end of the line', () => {
    expect(columnToOffset('abc', 99)).toBe(3);
  });
});

describe('tokenEnd', () => {
  it('covers a whole string literal', () => {
    const line = 'name = "bad name" # c';
    expect(line.slice(7, tokenEnd(line, 7))).toBe('"bad name"');
  });

  it('covers a string with escaped quotes', () => {
    const line = 'ask("a \\" b") x';
    expect(line.slice(4, tokenEnd(line, 4))).toBe('"a \\" b"');
  });

  it('covers a word', () => {
    expect('step twice():'.slice(5, tokenEnd('step twice():', 5))).toBe('twice');
  });

  it('covers leading whitespace for indentation errors', () => {
    expect(tokenEnd('  ask("x")', 0)).toBe(2);
  });

  it('covers one character otherwise', () => {
    expect(tokenEnd('a = b', 2)).toBe(3);
    expect(tokenEnd('abc', 3)).toBe(3);
  });
});

describe('parseStageLine', () => {
  it('reads the stage lines of a build', () => {
    expect(parseStageLine('[compile]  ok (0.6 s, -O3)')).toEqual({ tag: 'compile', message: 'ok (0.6 s, -O3)' });
    expect(parseStageLine('[run]      step 3 (step3): ok')).toEqual({ tag: 'run', message: 'step 3 (step3): ok' });
  });

  it('ignores program output and doctor marks', () => {
    expect(parseStageLine('sum=15')).toBeUndefined();
    expect(parseStageLine('[ ok ] sandbox: available')).toBeUndefined();
    expect(parseStageLine('[FAIL] platform: x')).toBeUndefined();
  });
});

describe('parseFailure', () => {
  it('reads the error and its hint', () => {
    const stderr = 'seqc: error: the generated program was not accepted after 3 attempt(s)\n  the attempts are kept in output/temp/runs/x/attempts\n';
    expect(parseFailure(stderr)).toEqual({
      message: 'the generated program was not accepted after 3 attempt(s)',
      hint: 'the attempts are kept in output/temp/runs/x/attempts',
    });
  });

  it('reads an error without a hint', () => {
    expect(parseFailure('seqc: error: cancelled\n')).toEqual({ message: 'cancelled', hint: undefined });
  });

  it('returns nothing when seqc printed no error', () => {
    expect(parseFailure('warning: something\n')).toBeUndefined();
  });
});

describe('LineSplitter', () => {
  it('joins lines that arrive in pieces', () => {
    const splitter = new LineSplitter();
    expect(splitter.push('[plan]     acc')).toEqual([]);
    expect(splitter.push('epted\r\n[compile]  ok\nrest')).toEqual(['[plan]     accepted', '[compile]  ok']);
    expect(splitter.flush()).toEqual(['rest']);
    expect(splitter.flush()).toEqual([]);
  });
});
