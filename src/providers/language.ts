// Editor features that need no compiler: outline, folding, completion, hover,
// links, formatting, and rename. They read the tolerant outline of the
// document; validity is left to seqc.

import * as vscode from 'vscode';
import { ERROR_CODES, KEYWORD_DOCS, LIMITS, REFERENCE_MODEL_URL, RESERVED_WORDS } from '../core/codes';
import { commentStart, isIdentifier, parseOutline, utf8Length, type Span, type StepDecl } from '../core/document';
import { formatDocument } from '../core/edits';
import type { Projects } from '../project';
import { codeOf } from './diagnostics';

export const SELECTOR: vscode.DocumentSelector = { language: 'seq' };

export function toRange(span: Span): vscode.Range {
  return new vscode.Range(span.line, span.start, span.line, span.end);
}

function stepRange(document: vscode.TextDocument, step: StepDecl): vscode.Range {
  return new vscode.Range(step.keyword.line, 0, step.endLine, document.lineAt(step.endLine).text.length);
}

class SymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const outline = parseOutline(document.getText());
    const symbols: vscode.DocumentSymbol[] = [];
    for (const header of outline.headers) {
      const line = document.lineAt(header.keyword.line).range;
      symbols.push(
        new vscode.DocumentSymbol(header.kind, header.value ?? '', vscode.SymbolKind.Property, line, toRange(header.keyword)),
      );
    }
    for (const step of outline.steps) {
      const count = step.asks.length;
      const symbol = new vscode.DocumentSymbol(
        step.name || '(unnamed step)',
        `${count} request${count === 1 ? '' : 's'}`,
        vscode.SymbolKind.Function,
        stepRange(document, step),
        step.name ? toRange(step.nameSpan) : toRange(step.keyword),
      );
      for (const ask of step.asks) {
        const line = document.lineAt(ask.keyword.line).range;
        symbol.children.push(
          new vscode.DocumentSymbol(
            ask.request?.value.replace(/\s+/g, ' ') || 'ask',
            '',
            vscode.SymbolKind.String,
            line,
            ask.request ? toRange(ask.request) : toRange(ask.keyword),
          ),
        );
      }
      symbols.push(symbol);
    }
    return symbols;
  }
}

class FoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    return parseOutline(document.getText())
      .steps.filter((step) => step.endLine > step.keyword.line)
      .map((step) => new vscode.FoldingRange(step.keyword.line, step.endLine));
  }
}

class CompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const line = document.lineAt(position.line).text;
    const before = line.slice(0, position.character);
    const hash = commentStart(before);
    if (hash >= 0) return [];

    if (/^backend\s*\.\s*\w*$/.test(before)) {
      const item = new vscode.CompletionItem('C', vscode.CompletionItemKind.EnumMember);
      item.insertText = line.slice(position.character).trimStart().startsWith('(') ? 'C' : 'C()';
      item.detail = 'The only backend in v0.1';
      return [item];
    }
    if (/^model\s*\(\s*"[^"]*$/.test(before)) {
      const item = new vscode.CompletionItem(REFERENCE_MODEL_URL, vscode.CompletionItemKind.Value);
      item.detail = 'The reference model';
      const start = before.lastIndexOf('"') + 1;
      item.range = new vscode.Range(position.line, start, position.line, position.character);
      return [item];
    }
    // Inside any other string, the text is a request in natural language.
    if ((before.match(/(?<!\\)"/g)?.length ?? 0) % 2 === 1) return [];

    const outline = parseOutline(document.getText());
    const word = /[A-Za-z_]*$/.exec(before)![0];
    const prefix = before.slice(0, before.length - word.length);
    const items: vscode.CompletionItem[] = [];
    const snippet = (label: string, body: string, kind: vscode.CompletionItemKind, doc: string) => {
      const item = new vscode.CompletionItem(label, kind);
      item.insertText = new vscode.SnippetString(body);
      item.documentation = new vscode.MarkdownString(doc);
      items.push(item);
    };

    if (prefix === '') {
      const has = (kind: string) => outline.headers.some((header) => header.kind === kind);
      if (!has('model')) snippet('model', `model("\${1:${REFERENCE_MODEL_URL}}")`, vscode.CompletionItemKind.Function, KEYWORD_DOCS.model);
      if (!has('backend')) snippet('backend', 'backend.C()', vscode.CompletionItemKind.Module, KEYWORD_DOCS.backend);
      if (!has('name')) snippet('name', 'name = "${1:name}"', vscode.CompletionItemKind.Variable, KEYWORD_DOCS.name);
      const next = `step${outline.steps.length + 1}`;
      snippet('step', `step \${1:${next}}():\n    ask("\${2:request}")`, vscode.CompletionItemKind.Keyword, KEYWORD_DOCS.step);
    }
    if (/^\s+$/.test(prefix) || (prefix === '' && outline.steps.some((step) => step.keyword.line < position.line))) {
      const item = new vscode.CompletionItem('ask', vscode.CompletionItemKind.Function);
      item.insertText = new vscode.SnippetString((prefix === '' ? '    ' : '') + 'ask("${1:request}")');
      item.documentation = new vscode.MarkdownString(KEYWORD_DOCS.ask);
      items.push(item);
    }
    return items;
  }
}

class HoverProvider implements vscode.HoverProvider {
  constructor(private readonly projects: Projects) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const text = document.lineAt(position.line).text;
    const hash = commentStart(text);
    if (hash >= 0 && position.character >= hash) return undefined;

    const outline = parseOutline(document.getText());
    const inside = (span: Span | undefined) =>
      span !== undefined && span.line === position.line && position.character >= span.start && position.character <= span.end;

    for (const step of outline.steps) {
      if (inside(step.keyword)) return new vscode.Hover(new vscode.MarkdownString(KEYWORD_DOCS.step), toRange(step.keyword));
      if (step.name && inside(step.nameSpan)) return new vscode.Hover(this.describeStep(document, step, outline.steps.length), toRange(step.nameSpan));
      for (const ask of step.asks) {
        if (inside(ask.keyword)) return new vscode.Hover(new vscode.MarkdownString(KEYWORD_DOCS.ask), toRange(ask.keyword));
        if (ask.request && inside(ask.request)) {
          const bytes = utf8Length(ask.request.value);
          const over = bytes > LIMITS.requestBytes ? ',over the limit' : '';
          return new vscode.Hover(`Request: ${bytes} of ${LIMITS.requestBytes} bytes${over}`, toRange(ask.request));
        }
      }
    }
    for (const header of outline.headers) {
      if (inside(header.keyword)) {
        return new vscode.Hover(new vscode.MarkdownString(KEYWORD_DOCS[header.kind]), toRange(header.keyword));
      }
    }

    // A seqc error under the cursor: what the code stands for.
    for (const diagnostic of vscode.languages.getDiagnostics(document.uri)) {
      const code = codeOf(diagnostic);
      if (code && ERROR_CODES[code] && diagnostic.range.contains(position)) {
        return new vscode.Hover(new vscode.MarkdownString(`**${code}**,${ERROR_CODES[code]}`), diagnostic.range);
      }
    }
    return undefined;
  }

  private describeStep(document: vscode.TextDocument, step: StepDecl, total: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    const asks = step.asks.length;
    md.appendMarkdown(`**step ${step.index} of ${total}**,${asks} of ${LIMITS.asksPerStep} requests\n\n`);
    const root = this.projects.rootFor(document.uri);
    const snapshot = root ? this.projects.snapshot(root) : undefined;
    const planned = snapshot?.build?.plan?.steps?.find((item) => item.index === step.index && item.name === step.name);
    if (planned) {
      if (planned.summary) md.appendMarkdown(`Plan: ${planned.summary}\n\n`);
      if (planned.reads?.length) md.appendMarkdown(`Reads: ${planned.reads.map((f) => `\`${f}\``).join(', ')}\n\n`);
      if (planned.writes?.length) md.appendMarkdown(`Writes: ${planned.writes.map((f) => `\`${f}\``).join(', ')}\n\n`);
      md.appendMarkdown(`Generated as \`seq_step_${step.index}\`.`);
    }
    return md;
  }
}

class LinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    const links: vscode.DocumentLink[] = [];
    for (const header of parseOutline(document.getText()).headers) {
      if (header.kind !== 'model' || !header.value || !header.valueSpan) continue;
      if (!/^https:\/\/[^\s"]+$/.test(header.value)) continue;
      try {
        links.push(new vscode.DocumentLink(toRange(header.valueSpan), vscode.Uri.parse(header.value, true)));
      } catch {
        // Not a URL the editor can open; seqc reports what is wrong with it.
      }
    }
    return links;
  }
}

class FormattingProvider implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
    const text = document.getText();
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const formatted = formatDocument(text, eol);
    if (formatted === text) return [];
    const whole = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
    return [vscode.TextEdit.replace(whole, formatted)];
  }
}

class RenameProvider implements vscode.RenameProvider {
  prepareRename(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
    const step = this.stepAt(document, position);
    if (!step) throw new Error('Only step names can be renamed.');
    return toRange(step.nameSpan);
  }

  provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string): vscode.WorkspaceEdit {
    const outline = parseOutline(document.getText());
    const step = this.stepAt(document, position);
    if (!step) throw new Error('Only step names can be renamed.');
    if (!isIdentifier(newName)) throw new Error('A step name is letters, digits, and underscores, and does not start with a digit.');
    if ((RESERVED_WORDS as readonly string[]).includes(newName)) throw new Error(`'${newName}' is a reserved word.`);
    if (outline.steps.some((other) => other.index !== step.index && other.name === newName)) {
      throw new Error(`A step named '${newName}' already exists.`);
    }
    // A step name is a label: nothing else in the file refers to it.
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, toRange(step.nameSpan), newName);
    return edit;
  }

  private stepAt(document: vscode.TextDocument, position: vscode.Position): StepDecl | undefined {
    return parseOutline(document.getText()).steps.find(
      (step) =>
        step.name !== '' &&
        step.nameSpan.line === position.line &&
        position.character >= step.nameSpan.start &&
        position.character <= step.nameSpan.end,
    );
  }
}

export function registerLanguageFeatures(projects: Projects): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, new SymbolProvider()),
    vscode.languages.registerFoldingRangeProvider(SELECTOR, new FoldingProvider()),
    vscode.languages.registerCompletionItemProvider(SELECTOR, new CompletionProvider(), '.', '"'),
    vscode.languages.registerHoverProvider(SELECTOR, new HoverProvider(projects)),
    vscode.languages.registerDocumentLinkProvider(SELECTOR, new LinkProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(SELECTOR, new FormattingProvider()),
    vscode.languages.registerRenameProvider(SELECTOR, new RenameProvider()),
  );
}
