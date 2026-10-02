// Diagnostics come only from seqc: `seqc check` when a file is opened or
// saved, and the errors a build prints before it does anything else.

import * as path from 'node:path';
import * as vscode from 'vscode';
import { DIAGNOSTICS_DOC_URL } from '../core/codes';
import { columnToOffset, parseDiagnostics, parseFailure, tokenEnd, type SeqcDiagnostic } from '../core/seqcOutput';
import { execSeqc, reportSeqcNotFound } from '../seqc/invoke';

export type CheckOutcome =
  | { kind: 'ok' }
  | { kind: 'errors'; count: number }
  | { kind: 'not-found' }
  | { kind: 'failed'; message: string }
  | { kind: 'skipped' };

export class SeqDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('seq');
  private readonly running = new Map<string, vscode.CancellationTokenSource>();
  private readonly disposables: vscode.Disposable[] = [this.collection];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((document) => void this.checkAutomatically(document)),
      vscode.workspace.onDidSaveTextDocument((document) => void this.checkAutomatically(document)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        this.running.get(document.uri.toString())?.cancel();
        this.collection.delete(document.uri);
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.checkOpenDocuments()),
    );
  }

  dispose(): void {
    for (const source of this.running.values()) source.cancel();
    for (const item of this.disposables) item.dispose();
  }

  checkOpenDocuments(): void {
    for (const document of vscode.workspace.textDocuments) void this.checkAutomatically(document);
  }

  private async checkAutomatically(document: vscode.TextDocument): Promise<void> {
    if (!vscode.workspace.getConfiguration('seq', document).get<boolean>('check.onSave', true)) return;
    await this.check(document, false);
  }

  /**
   * Runs `seqc check` on the file as saved on disk and publishes what it
   * reports. `explicit` is true when the user asked for the check.
   */
  async check(document: vscode.TextDocument, explicit: boolean): Promise<CheckOutcome> {
    if (document.languageId !== 'seq' || document.uri.scheme !== 'file' || !vscode.workspace.isTrusted) {
      return { kind: 'skipped' };
    }
    const key = document.uri.toString();
    this.running.get(key)?.cancel();
    const source = new vscode.CancellationTokenSource();
    this.running.set(key, source);

    // A relative path and the file's directory as the working directory: the
    // same arguments then work for a native seqc and for one inside WSL.
    const file = document.uri.fsPath;
    const result = await execSeqc(['check', path.basename(file)], path.dirname(file), source.token);
    if (source.token.isCancellationRequested) return { kind: 'skipped' };
    this.running.delete(key);

    if (result.notFound) {
      void reportSeqcNotFound(explicit);
      return { kind: 'not-found' };
    }
    if (result.code === 0) {
      this.collection.set(document.uri, []);
      return { kind: 'ok' };
    }
    const count = this.publish(document, result.stderr);
    if (count > 0) return { kind: 'errors', count };
    const failure = parseFailure(result.stderr);
    return { kind: 'failed', message: failure?.message ?? `seqc check exited with status ${result.code}` };
  }

  /** Publishes the diagnostics found in seqc's standard error. Returns how many there were. */
  publish(document: vscode.TextDocument, stderr: string): number {
    const diagnostics = parseDiagnostics(stderr).map((item) => toDiagnostic(document, item));
    this.collection.set(document.uri, diagnostics);
    return diagnostics.length;
  }

  clear(uri: vscode.Uri): void {
    this.collection.set(uri, []);
  }
}

function toDiagnostic(document: vscode.TextDocument, item: SeqcDiagnostic): vscode.Diagnostic {
  const line = Math.min(Math.max(item.line - 1, 0), Math.max(document.lineCount - 1, 0));
  const text = document.lineAt(line).text;
  const start = columnToOffset(text, item.column);
  const end = Math.max(tokenEnd(text, start), Math.min(start + 1, text.length));
  const range = new vscode.Range(line, start, line, end);

  const diagnostic = new vscode.Diagnostic(
    range,
    item.message,
    item.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error,
  );
  diagnostic.source = 'seqc';
  diagnostic.code = { value: item.code, target: vscode.Uri.parse(DIAGNOSTICS_DOC_URL) };
  if (item.hint) {
    diagnostic.relatedInformation = [
      new vscode.DiagnosticRelatedInformation(new vscode.Location(document.uri, range), `hint: ${item.hint}`),
    ];
  }
  return diagnostic;
}

/** The seqc error code of a diagnostic this extension published. */
export function codeOf(diagnostic: vscode.Diagnostic): string | undefined {
  if (diagnostic.source !== 'seqc') return undefined;
  const code = diagnostic.code;
  if (typeof code === 'object' && code !== null) return String(code.value);
  return code === undefined ? undefined : String(code);
}
