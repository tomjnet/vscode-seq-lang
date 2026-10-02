// Quick fixes for the seqc errors that have one obvious repair.

import * as vscode from 'vscode';
import { REFERENCE_MODEL_URL } from '../core/codes';
import { parseOutline } from '../core/document';
import {
  fixAskParentheses,
  fixBackend,
  fixModelAssignment,
  fixStepParameters,
  reindentLine,
  replaceTabs,
  uniqueStepName,
} from '../core/edits';
import { codeOf } from './diagnostics';
import { toRange } from './language';

type LineFix = (line: string) => string | undefined;

const LINE_FIXES: Record<string, { title: string; fix: LineFix }> = {
  E0103: { title: 'Replace tabs with spaces', fix: replaceTabs },
  E0108: { title: 'Fix indentation', fix: reindentLine },
  E0202: { title: 'Write model as a call: model("...")', fix: fixModelAssignment },
  E0203: { title: 'Write backend.C()', fix: fixBackend },
  E0204: { title: 'Add parentheses: ask("...")', fix: fixAskParentheses },
  E0211: { title: 'Remove the parameters', fix: fixStepParameters },
  E0305: { title: 'Use backend.C()', fix: fixBackend },
  E0306: { title: 'Use backend.C()', fix: fixBackend },
  E0320: { title: 'Remove the arguments', fix: fixBackend },
};

const MISSING_HEADERS: Record<string, { title: string; text: (document: vscode.TextDocument) => string }> = {
  E0301: { title: 'Add the model declaration', text: () => `model("${REFERENCE_MODEL_URL}")` },
  E0302: { title: 'Add backend.C()', text: () => 'backend.C()' },
  E0303: {
    title: 'Add the name declaration',
    text: (document) => {
      // <project>/src/main.seq is named after its project directory.
      const parts = document.uri.path.split('/');
      const project = parts.length >= 3 && parts[parts.length - 2] === 'src' ? parts[parts.length - 3] : '';
      return `name = "${/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(project) ? project : 'name'}"`;
    },
  },
};

export class SeqCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      const code = codeOf(diagnostic);
      if (!code) continue;
      const line = diagnostic.range.start.line;
      if (line >= document.lineCount) continue;

      const lineFix = LINE_FIXES[code];
      if (lineFix) {
        const text = document.lineAt(line).text;
        const fixed = lineFix.fix(text);
        if (fixed !== undefined && fixed !== text) {
          const action = this.action(lineFix.title, diagnostic);
          action.edit!.replace(document.uri, document.lineAt(line).range, fixed);
          actions.push(action);
        }
      }

      const header = MISSING_HEADERS[code];
      if (header) {
        const action = this.action(header.title, diagnostic);
        this.insertHeader(action.edit!, document, header.text(document));
        actions.push(action);
      }

      if (code === 'E0315') {
        const outline = parseOutline(document.getText());
        const step = outline.steps.find((item) => item.keyword.line === line);
        if (step?.name) {
          const name = uniqueStepName(
            step.name,
            outline.steps.map((item) => item.name),
          );
          const action = this.action(`Rename to '${name}'`, diagnostic);
          action.edit!.replace(document.uri, toRange(step.nameSpan), name);
          actions.push(action);
        }
      }
    }
    return actions;
  }

  private action(title: string, diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.diagnostics = [diagnostic];
    action.edit = new vscode.WorkspaceEdit();
    action.isPreferred = true;
    return action;
  }

  /** Inserts a declaration after the last header declaration, else at the top. */
  private insertHeader(edit: vscode.WorkspaceEdit, document: vscode.TextDocument, text: string): void {
    const outline = parseOutline(document.getText());
    const firstStep = outline.steps[0]?.keyword.line ?? Number.MAX_SAFE_INTEGER;
    const headers = outline.headers.filter((header) => header.keyword.line < firstStep);
    if (headers.length === 0) {
      edit.insert(document.uri, new vscode.Position(0, 0), text + '\n');
      return;
    }
    const last = Math.max(...headers.map((header) => header.keyword.line));
    if (last + 1 < document.lineCount) {
      edit.insert(document.uri, new vscode.Position(last + 1, 0), text + '\n');
    } else {
      // The header is the last line of a file without a final newline.
      edit.insert(document.uri, document.lineAt(last).range.end, '\n' + text);
    }
  }
}
