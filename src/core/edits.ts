// Pure text transformations behind the formatter and the quick fixes. They
// work on single lines and never change the inside of a string literal.

import { commentStart, findString, splitLines } from './document';

/** True when the line has a string literal that is not closed. */
function hasOpenString(line: string): boolean {
  const hash = commentStart(line);
  const code = hash < 0 ? line : line.slice(0, hash);
  let from = 0;
  for (;;) {
    const literal = findString(code, 0, from);
    if (!literal) return false;
    if (!literal.terminated) return true;
    from = literal.end;
  }
}

/** The indentation seqc expects for a line: four spaces for ask(), none otherwise. */
export function expectedIndent(line: string): string {
  return /^\s*ask\b/.test(line) ? '    ' : '';
}

export function reindentLine(line: string): string {
  return expectedIndent(line) + line.replace(/^[ \t]+/, '');
}

/** Replaces tabs outside string literals: leading tabs with indentation, others with one space. */
export function replaceTabs(line: string): string {
  const leading = /^[ \t]*/.exec(line)![0];
  let out = leading.includes('\t') ? expectedIndent(line) : leading;
  let inString = false;
  for (let i = leading.length; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      // A raw tab inside a string is still an error; \t is the way to write one.
      out += c === '\t' ? '\\t' : c;
      if (c === '\\' && i + 1 < line.length) out += line[++i];
      else if (c === '"') inString = false;
    } else {
      if (c === '"') inString = true;
      out += c === '\t' ? ' ' : c;
    }
  }
  return out;
}

/**
 * Formats a whole document: indentation normalized to 0 or 4 spaces, trailing
 * whitespace removed, runs of blank lines collapsed, one final newline.
 */
export function formatDocument(text: string, eol: string): string {
  const out: string[] = [];
  let blank = 0;
  for (const original of splitLines(text)) {
    let line = original;
    if (!hasOpenString(line)) line = line.replace(/[ \t]+$/, '');
    if (line.trim() === '') {
      blank++;
      continue;
    }
    if (out.length > 0 && blank > 0) out.push('');
    blank = 0;
    // A comment keeps its place relative to what follows: it is indented like
    // an ask() only when it already is indented.
    const isComment = /^\s*#/.test(line);
    out.push(isComment ? (/^\s/.test(line) ? '    ' : '') + line.trimStart() : reindentLine(line));
  }
  return out.length === 0 ? '' : out.join(eol) + eol;
}

/** `ask "x"` -> `ask("x")`. Returns undefined when the line is not of that shape. */
export function fixAskParentheses(line: string): string | undefined {
  const m = /^(\s*ask)\s*(?=")/.exec(line);
  if (!m) return undefined;
  const literal = findString(line, 0, m[0].length);
  if (!literal || !literal.terminated) return undefined;
  return `${m[1]}(${line.slice(literal.start, literal.end)})${line.slice(literal.end)}`;
}

/** `model = "url"` -> `model("url")`. */
export function fixModelAssignment(line: string): string | undefined {
  const m = /^(model)\s*=\s*(?=")/.exec(line);
  if (!m) return undefined;
  const literal = findString(line, 0, m[0].length);
  if (!literal || !literal.terminated) return undefined;
  return `model(${line.slice(literal.start, literal.end)})${line.slice(literal.end)}`;
}

/** Any `backend ...` line -> `backend.C()`, keeping a trailing comment. */
export function fixBackend(line: string): string | undefined {
  if (!/^backend\b/.test(line)) return undefined;
  const hash = commentStart(line);
  if (hash < 0) return 'backend.C()';
  const gap = /\s*$/.exec(line.slice(0, hash))![0] || '  ';
  return `backend.C()${gap}${line.slice(hash)}`;
}

/** `step name(a, b):` -> `step name():`. */
export function fixStepParameters(line: string): string | undefined {
  const m = /^(step\s+[A-Za-z_][A-Za-z0-9_]*\s*)\([^)]*\)/.exec(line);
  return m ? `${m[1].trimEnd()}()${line.slice(m[0].length)}` : undefined;
}

/** A step name that is not in `taken`: name2, name3, ... */
export function uniqueStepName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = name.replace(/\d+$/, '') || 'step';
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
