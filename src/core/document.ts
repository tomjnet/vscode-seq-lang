// A tolerant, line-based outline of a Seq source file. It is not a validator:
// seqc is the only authority on what is valid. This only finds the pieces the
// editor features need (headers, steps, requests) and never rejects anything.

export interface Span {
  line: number; // 0-based
  start: number; // UTF-16 offset in the line
  end: number; // exclusive
}

export interface StringLiteral extends Span {
  /** Raw text between the quotes, escapes not decoded. */
  raw: string;
  /** Decoded value: \" \\ \n \t applied. */
  value: string;
  terminated: boolean;
}

export interface HeaderDecl {
  kind: 'model' | 'backend' | 'name';
  keyword: Span;
  /** The string argument of model()/name, or the backend identifier. */
  value?: string;
  valueSpan?: Span;
}

export interface AskStmt {
  keyword: Span;
  request?: StringLiteral;
}

export interface StepDecl {
  /** 1-based position among steps; the generated C function is seq_step_<index>. */
  index: number;
  name: string;
  keyword: Span;
  nameSpan: Span;
  asks: AskStmt[];
  /** Last line that belongs to the step (0-based, inclusive). */
  endLine: number;
}

export interface Outline {
  headers: HeaderDecl[];
  steps: StepDecl[];
}

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
const STEP_RE = new RegExp(`^(step)\\b(?:\\s+(${IDENT}))?`);
const ASK_RE = /^(\s+)(ask)\b/;
const MODEL_RE = /^(model)\b/;
const NAME_RE = /^(name)\b/;
const BACKEND_RE = new RegExp(`^(backend)\\b(?:\\s*\\.\\s*(${IDENT}))?`);

export function decodeString(raw: string): string {
  return raw.replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

/** The first string literal that starts at or after `from` in `text`. */
export function findString(text: string, line: number, from: number): StringLiteral | undefined {
  const open = text.indexOf('"', from);
  if (open < 0) return undefined;
  let i = open + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '"') break;
    i++;
  }
  const terminated = i < text.length;
  const close = terminated ? i : text.length;
  const raw = text.slice(open + 1, close);
  return { line, start: open, end: terminated ? close + 1 : close, raw, value: decodeString(raw), terminated };
}

/** Offset of the `#` that starts a comment, or -1. A `#` inside a string does not count. */
export function commentStart(text: string): number {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '#') {
      return i;
    }
  }
  return -1;
}

function stripComment(text: string): string {
  const at = commentStart(text);
  return at < 0 ? text : text.slice(0, at);
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export function parseOutline(text: string): Outline {
  const lines = splitLines(text);
  const outline: Outline = { headers: [], steps: [] };
  let current: StepDecl | undefined;

  for (let line = 0; line < lines.length; line++) {
    const code = stripComment(lines[line]);
    if (code.trim() === '') continue;

    let m: RegExpExecArray | null;
    if ((m = STEP_RE.exec(code))) {
      const name = m[2] ?? '';
      const nameStart = name ? code.indexOf(name, m[1].length) : m[0].length;
      current = {
        index: outline.steps.length + 1,
        name,
        keyword: { line, start: 0, end: 4 },
        nameSpan: { line, start: nameStart, end: nameStart + name.length },
        asks: [],
        endLine: line,
      };
      outline.steps.push(current);
    } else if ((m = ASK_RE.exec(code))) {
      const start = m[1].length;
      const ask: AskStmt = {
        keyword: { line, start, end: start + 3 },
        request: findString(code, line, start + 3),
      };
      if (current) {
        current.asks.push(ask);
        current.endLine = line;
      }
    } else if ((m = MODEL_RE.exec(code))) {
      current = undefined;
      const literal = findString(code, line, 5);
      outline.headers.push({
        kind: 'model',
        keyword: { line, start: 0, end: 5 },
        value: literal?.value,
        valueSpan: literal && { line, start: literal.start + 1, end: literal.terminated ? literal.end - 1 : literal.end },
      });
    } else if ((m = NAME_RE.exec(code))) {
      current = undefined;
      const literal = findString(code, line, 4);
      outline.headers.push({
        kind: 'name',
        keyword: { line, start: 0, end: 4 },
        value: literal?.value,
        valueSpan: literal && { line, start: literal.start + 1, end: literal.terminated ? literal.end - 1 : literal.end },
      });
    } else if ((m = BACKEND_RE.exec(code))) {
      current = undefined;
      const ident = m[2];
      const identStart = ident ? code.indexOf(ident, 7) : -1;
      outline.headers.push({
        kind: 'backend',
        keyword: { line, start: 0, end: 7 },
        value: ident,
        valueSpan: ident ? { line, start: identStart, end: identStart + ident.length } : undefined,
      });
    } else if (current && /^\s/.test(code)) {
      // Something indented that is not ask(): still part of the step body.
      current.endLine = line;
    }
  }
  return outline;
}

export function isIdentifier(text: string): boolean {
  return new RegExp(`^${IDENT}$`).test(text);
}

export function utf8Length(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}
