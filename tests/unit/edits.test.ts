import { describe, expect, it } from 'vitest';
import {
  fixAskParentheses,
  fixBackend,
  fixModelAssignment,
  fixStepParameters,
  formatDocument,
  reindentLine,
  replaceTabs,
  uniqueStepName,
} from '../../src/core/edits';

describe('quick-fix edits', () => {
  it('adds parentheses to ask', () => {
    expect(fixAskParentheses('    ask "no parentheses"')).toBe('    ask("no parentheses")');
    expect(fixAskParentheses('    ask "a \\" b"  # note')).toBe('    ask("a \\" b")  # note');
    expect(fixAskParentheses('    ask("fine")')).toBeUndefined();
    expect(fixAskParentheses('    ask "open')).toBeUndefined();
  });

  it('turns a model assignment into a call', () => {
    expect(fixModelAssignment('model = "https://huggingface.co/a/b"')).toBe('model("https://huggingface.co/a/b")');
    expect(fixModelAssignment('model("x")')).toBeUndefined();
  });

  it('rewrites any backend line as backend.C()', () => {
    expect(fixBackend('backend = "c"')).toBe('backend.C()');
    expect(fixBackend('backend.Rust()')).toBe('backend.C()');
    expect(fixBackend('backend.C(1)   # the only one')).toBe('backend.C()   # the only one');
    expect(fixBackend('name = "x"')).toBeUndefined();
  });

  it('removes step parameters', () => {
    expect(fixStepParameters('step go(a, b):')).toBe('step go():');
    expect(fixStepParameters('step go ():')).toBe('step go():');
    expect(fixStepParameters('ask("x")')).toBeUndefined();
  });

  it('re-indents to 0 or 4 spaces', () => {
    expect(reindentLine('  ask("two spaces")')).toBe('    ask("two spaces")');
    expect(reindentLine('  step a():')).toBe('step a():');
    expect(reindentLine('\tname = "x"')).toBe('name = "x"');
  });

  it('replaces tabs without changing what a string means', () => {
    expect(replaceTabs('\task("x")')).toBe('    ask("x")');
    expect(replaceTabs('name\t=\t"x"')).toBe('name = "x"');
    expect(replaceTabs('    ask("a\tb")')).toBe('    ask("a\\tb")');
  });

  it('picks a step name that is free', () => {
    expect(uniqueStepName('twice', ['twice', 'other'])).toBe('twice2');
    expect(uniqueStepName('step1', ['step1', 'step2'])).toBe('step3');
  });
});

describe('formatDocument', () => {
  it('normalizes indentation, blank lines, and trailing whitespace', () => {
    const input = [
      '',
      'model("https://huggingface.co/a/b")   ',
      '  backend.C()',
      'name = "x"',
      '',
      '',
      '',
      'step one():',
      '  ask("a")',
      '\task("b")  ',
      '      # about the next request',
      '    ask("c")',
      '# top-level comment',
      'step two():',
      'ask("d")',
      '',
    ].join('\n');
    expect(formatDocument(input, '\n')).toBe(
      [
        'model("https://huggingface.co/a/b")',
        'backend.C()',
        'name = "x"',
        '',
        'step one():',
        '    ask("a")',
        '    ask("b")',
        '    # about the next request',
        '    ask("c")',
        '# top-level comment',
        'step two():',
        '    ask("d")',
        '',
      ].join('\n'),
    );
  });

  it('leaves a formatted file alone', () => {
    const text = 'name = "x"\n\nstep a():\n    ask("  spaced  ")\n';
    expect(formatDocument(text, '\n')).toBe(text);
  });

  it('keeps CRLF when asked to', () => {
    expect(formatDocument('name = "x"\r\nstep a():\r\n  ask("y")', '\r\n')).toBe('name = "x"\r\nstep a():\r\n    ask("y")\r\n');
  });

  it('does not trim inside an unterminated string', () => {
    expect(formatDocument('    ask("open   ', '\n')).toBe('    ask("open   \n');
  });

  it('returns an empty file for only whitespace', () => {
    expect(formatDocument('\n  \n', '\n')).toBe('');
  });
});
