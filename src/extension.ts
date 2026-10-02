import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { Projects } from './project';
import { SeqCodeActions } from './providers/codeActions';
import { SeqCodeLenses } from './providers/codeLens';
import { SeqDiagnostics } from './providers/diagnostics';
import { SELECTOR, registerLanguageFeatures } from './providers/language';
import { SeqcTasks } from './seqc/tasks';
import { SeqStatusBar } from './statusBar';
import { BuildTree } from './views/buildTree';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const projects = new Projects();
  const tasks = new SeqcTasks(() => projects.all());
  const diagnostics = new SeqDiagnostics();
  const lenses = new SeqCodeLenses(projects);
  const tree = new BuildTree(projects);

  context.subscriptions.push(
    projects,
    tasks,
    diagnostics,
    lenses,
    tree,
    new SeqStatusBar(tasks),
    registerLanguageFeatures(projects),
    vscode.languages.registerCodeLensProvider(SELECTOR, lenses),
    vscode.languages.registerCodeActionsProvider(SELECTOR, new SeqCodeActions(), {
      providedCodeActionKinds: SeqCodeActions.kinds,
    }),
    vscode.tasks.registerTaskProvider(SeqcTasks.type, tasks),
    vscode.window.createTreeView('seq.build', { treeDataProvider: tree, showCollapseAll: true }),
    registerCommands({ projects, tasks, diagnostics }),
    // A .seq file opened from outside the workspace can be a project too.
    vscode.workspace.onDidOpenTextDocument((document) => {
      const root = document.languageId === 'seq' ? projects.rootFor(document.uri) : undefined;
      if (root && !projects.all().includes(root)) void projects.discover();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('seq.seqcPath') || event.affectsConfiguration('seq.useWsl')) {
        diagnostics.checkOpenDocuments();
      }
    }),
  );

  await projects.discover();
  diagnostics.checkOpenDocuments();
}

export function deactivate(): void {}
