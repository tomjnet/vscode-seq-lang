// Parsing of what seqc prints. seqc 0.1 has no machine-readable output, so
// this reads the human format documented in seq-lang docs/language.md:
//
//   path:line:column: error[E0204]: ask requires parentheses
//           ask "hello"
//               ^
//       hint: write ask("...")

export interface SeqcDiagnostic {
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based, counted in Unicode code points. */
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  hint?: string;
}

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;
const HEADER_RE = /^(.*):(\d+):(\d+): (error|warning)\[([A-Z]\d{4})\]: (.*)$/;
const CARET_RE = /^ +\^$/;
const HINT_RE = /^ {4}hint: (.*)$/;
const STAGE_RE = /^\[([a-z+]+)\]\s+(.*)$/;
const FAILURE_RE = /^seqc: (?:internal )?error: (.*)$/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

export function parseDiagnostics(output: string): SeqcDiagnostic[] {
  const lines = stripAnsi(output).split(/\r?\n/);
  const result: SeqcDiagnostic[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADER_RE.exec(lines[i]);
    if (!m) continue;
    const diagnostic: SeqcDiagnostic = {
      path: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
      severity: m[4] as 'error' | 'warning',
      code: m[5],
      message: m[6],
    };
    // The source line and the caret come as a pair, and only then the hint.
    // Checking for the pair keeps a source line that itself reads "hint: ..."
    // from being taken as one.
    let next = i + 1;
    if (next + 1 < lines.length && lines[next].startsWith('    ') && CARET_RE.test(lines[next + 1])) {
      next += 2;
    }
    const hint = next < lines.length ? HINT_RE.exec(lines[next]) : null;
    if (hint) {
      diagnostic.hint = hint[1];
      next++;
    }
    i = next - 1;
    result.push(diagnostic);
  }
  return result;
}

/** Converts a 1-based code-point column into a UTF-16 offset in `lineText`. */
export function columnToOffset(lineText: string, column: number): number {
  let offset = 0;
  let remaining = column - 1;
  while (remaining > 0 && offset < lineText.length) {
    const code = lineText.codePointAt(offset)!;
    offset += code > 0xffff ? 2 : 1;
    remaining--;
  }
  return offset;
}

/**
 * The range a diagnostic at `offset` should underline: a whole string
 * literal, a whole word, or one character.
 */
export function tokenEnd(lineText: string, offset: number): number {
  if (offset >= lineText.length) return offset;
  const c = lineText[offset];
  if (c === '"') {
    let i = offset + 1;
    while (i < lineText.length) {
      if (lineText[i] === '\\') {
        i += 2;
        continue;
      }
      if (lineText[i] === '"') return i + 1;
      i++;
    }
    return lineText.length;
  }
  if (/[A-Za-z0-9_]/.test(c)) {
    let i = offset;
    while (i < lineText.length && /[A-Za-z0-9_]/.test(lineText[i])) i++;
    return i;
  }
  if (c === ' ' || c === '\t') {
    let i = offset;
    while (i < lineText.length && (lineText[i] === ' ' || lineText[i] === '\t')) i++;
    return i;
  }
  return offset + (lineText.codePointAt(offset)! > 0xffff ? 2 : 1);
}

export interface StageLine {
  /** check, inputs, cache, model, plan, generate, repair, policy, compile, link, test, build, run, publish. */
  tag: string;
  message: string;
}

export function parseStageLine(line: string): StageLine | undefined {
  const m = STAGE_RE.exec(stripAnsi(line));
  return m ? { tag: m[1], message: m[2] } : undefined;
}

/** The message of a `seqc: error: ...` line, and the indented hint that may follow it. */
export function parseFailure(output: string): { message: string; hint?: string } | undefined {
  const lines = stripAnsi(output).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = FAILURE_RE.exec(lines[i]);
    if (!m) continue;
    const hint = i + 1 < lines.length && /^ {2}\S/.test(lines[i + 1]) ? lines[i + 1].trim() : undefined;
    return { message: m[1], hint };
  }
  return undefined;
}

/** Splits a stream into lines as chunks arrive. */
export class LineSplitter {
  private pending = '';

  push(chunk: string): string[] {
    const text = this.pending + chunk;
    const lines = text.split('\n');
    this.pending = lines.pop() ?? '';
    return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  }

  flush(): string[] {
    const rest = this.pending;
    this.pending = '';
    return rest === '' ? [] : [rest];
  }
}
