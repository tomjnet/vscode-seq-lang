// Runs inside VS Code against tests/fixtures/project. Nothing here needs seqc:
// the compiler-backed features are covered by the unit tests of their parsers.

import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'tomjnet.vscode-seq-lang';
const root = vscode.workspace.workspaceFolders![0].uri;
const mainSeq = vscode.Uri.joinPath(root, 'src', 'main.seq');

async function openMain(): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(mainSeq);
  await vscode.window.showTextDocument(document);
  return document;
}

/** Providers register during activation; a feature may need a moment after the first request. */
async function eventually<T>(probe: () => Thenable<T | undefined>, accept: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = await probe();
    if (value !== undefined && accept(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('condition not met in time');
}

suite('Seq extension', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'extension is installed');
    await openMain();
    await extension.activate();
  });

  test('registers the language', async () => {
    const document = await openMain();
    assert.equal(document.languageId, 'seq');
  });

  test('registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['seq.run', 'seq.buildOnly', 'seq.check', 'seq.showGeneratedC', 'seq.newProject', 'seq.compareAttempts']) {
      assert.ok(commands.includes(id), `${id} is registered`);
    }
  });

  test('outlines headers and steps', async () => {
    const symbols = await eventually(
      () => vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', mainSeq),
      (list) => list.length > 0,
    );
    assert.deepEqual(
      symbols.map((s) => s.name),
      ['model', 'backend', 'name', 'make_numbers', 'add_numbers'],
    );
    assert.equal(symbols[4].children.length, 2);
    assert.equal(symbols[4].kind, vscode.SymbolKind.Function);
  });

  test('folds each step', async () => {
    const ranges = await eventually(
      () => vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', mainSeq),
      (list) => list.length > 0,
    );
    assert.deepEqual(
      ranges.map((r) => [r.start, r.end]),
      [
        [5, 6],
        [8, 10],
      ],
    );
  });

  test('shows lenses for the workflow and for each built step', async () => {
    const lenses = await eventually(
      () => vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', mainSeq, 100),
      (list) => list.some((lens) => lens.command?.command === 'seq.showGeneratedC'),
    );
    const titles = lenses.map((lens) => lens.command?.title ?? '');
    assert.ok(titles.includes('$(play) Run'), 'run lens');
    assert.ok(titles.some((t) => t.startsWith('$(pass) build accepted')), `build status lens in ${titles.join(' | ')}`);
    const generated = lenses.filter((lens) => lens.command?.command === 'seq.showGeneratedC');
    assert.deepEqual(
      generated.map((lens) => [lens.range.start.line, lens.command?.arguments?.[1]]),
      [
        [5, 1],
        [8, 2],
      ],
    );
    // The fixture's latest run executed the accepted build and every step passed.
    assert.equal(titles.filter((t) => t === '$(pass) ok').length, 2);
    assert.ok(titles.includes('numbers.txt → total.txt'), 'plan lens');
  });

  test('opens the generated C at the step function', async () => {
    await vscode.commands.executeCommand('seq.showGeneratedC', root.fsPath, 2);
    const editor = await eventually(
      async () => vscode.window.activeTextEditor,
      (active) => active.document.uri.fsPath.endsWith('numbers.c'),
    );
    assert.equal(editor.document.lineAt(editor.selection.start.line).text, 'int seq_step_2(seq_ctx *ctx) {');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('provides seqc tasks for the project', async () => {
    const tasks = await vscode.tasks.fetchTasks({ type: 'seqc' });
    assert.deepEqual(
      tasks.map((task) => task.name).sort(),
      ['build', 'check', 'run'],
    );
  });

  test('completes header keywords at the top level', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'seq', content: 'backend.C()\n\n' });
    const items = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      document.uri,
      new vscode.Position(1, 0),
    );
    const labels = items.items.map((item) => (typeof item.label === 'string' ? item.label : item.label.label));
    assert.ok(labels.includes('model') && labels.includes('name') && labels.includes('step'), labels.join(','));
    assert.ok(!labels.includes('backend'), 'a declared header is not offered again');
  });

  test('formats indentation', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'seq', content: 'step a():\n  ask("x")\n' });
    const edits = await eventually(
      () =>
        vscode.commands.executeCommand<vscode.TextEdit[]>('vscode.executeFormatDocumentProvider', document.uri, {
          tabSize: 4,
          insertSpaces: true,
        }),
      (list) => list.length > 0,
    );
    // The editor may minimize the provider's whole-document edit; the result is what matters.
    const edit = new vscode.WorkspaceEdit();
    edit.set(document.uri, edits);
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.equal(document.getText(), 'step a():\n    ask("x")\n');
  });

  test('offers a quick fix for a seqc diagnostic', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'seq', content: 'step a():\n    ask "x"\n' });
    const collection = vscode.languages.createDiagnosticCollection('test');
    const range = new vscode.Range(1, 8, 1, 11);
    const diagnostic = new vscode.Diagnostic(range, 'ask requires parentheses');
    diagnostic.source = 'seqc';
    diagnostic.code = 'E0204';
    collection.set(document.uri, [diagnostic]);
    try {
      const actions = await eventually(
        () => vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, range),
        (list) => list.length > 0,
      );
      assert.equal(actions[0].title, 'Add parentheses: ask("...")');
      const edit = actions[0].edit!.get(document.uri)[0];
      assert.equal(edit.newText, '    ask("x")');
    } finally {
      collection.dispose();
    }
  });

  test('links the model URL', async () => {
    const links = await eventually(
      () => vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', mainSeq),
      (list) => list.length > 0,
    );
    assert.equal(links[0].target?.toString(), 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct');
  });

  test('renames a step', async () => {
    const document = await openMain();
    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      mainSeq,
      new vscode.Position(5, 7),
      'first',
    );
    const [change] = edit.get(document.uri);
    assert.equal(document.getText(change.range), 'make_numbers');
    assert.equal(change.newText, 'first');
    assert.equal(path.basename(document.uri.fsPath), 'main.seq');
  });
});
