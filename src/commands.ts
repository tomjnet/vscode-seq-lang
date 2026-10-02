// The commands of the extension, and what happens after seqc exits.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { EXIT } from './core/codes';
import { parseFailure } from './core/seqcOutput';
import { artifactPaths, attemptSource, listAttempts, parseAttemptLabel, stepFunctionLines } from './core/records';
import type { Projects } from './project';
import type { SeqDiagnostics } from './providers/diagnostics';
import { execSeqc, outputChannel, reportSeqcNotFound } from './seqc/invoke';
import type { SeqcCommand, SeqcFinished, SeqcTasks } from './seqc/tasks';
import type { Node } from './views/buildTree';

interface Services {
  projects: Projects;
  tasks: SeqcTasks;
  diagnostics: SeqDiagnostics;
}

const NO_PROJECT =
  'No Seq project found. seqc builds <project>/src/main.seq; open that file or a folder that contains it.';

export function registerCommands(services: Services): vscode.Disposable {
  const { projects, tasks, diagnostics } = services;

  /** The project a command applies to: its argument, else the current one, else a pick. */
  async function resolveRoot(arg: unknown): Promise<string | undefined> {
    if (typeof arg === 'string') return arg;
    if (arg instanceof vscode.Uri) {
      const root = projects.rootFor(arg);
      if (root) return root;
    }
    const current = projects.current();
    if (current) return current;
    const roots = projects.all();
    if (roots.length === 0) {
      void vscode.window.showWarningMessage(NO_PROJECT);
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      roots.map((root) => ({ label: path.basename(root), description: vscode.workspace.asRelativePath(root), root })),
      { placeHolder: 'Select a Seq project' },
    );
    return picked?.root;
  }

  async function saveSource(root: string): Promise<vscode.TextDocument | undefined> {
    const source = projects.snapshot(root).paths.source;
    const document = vscode.workspace.textDocuments.find((item) => item.uri.scheme === 'file' && item.uri.fsPath === source);
    if (document?.isDirty) await document.save();
    return document;
  }

  async function runSeqc(command: SeqcCommand, arg: unknown, extra: string[] = []): Promise<void> {
    const root = await resolveRoot(arg);
    if (!root) return;
    projects.markUsed(root);
    await saveSource(root);
    const result = await tasks.run(command, root, extra);
    projects.refresh();
    await afterSeqc(result);
  }

  async function afterSeqc(result: SeqcFinished): Promise<void> {
    const { root, code } = result;
    if (result.notFound) return reportSeqcNotFound(true);
    if (code === undefined || code === EXIT.cancelled) return;

    const source = vscode.Uri.file(projects.snapshot(root).paths.source);
    const builds = result.command === 'run' || result.command === 'build' || result.command === 'rebuild';
    if (builds || result.command === 'check') {
      // A build prints the same diagnostics as `seqc check` and then stops.
      const document = await vscode.workspace.openTextDocument(source);
      if (code === EXIT.source) {
        diagnostics.publish(document, result.stderr);
        await vscode.commands.executeCommand('workbench.actions.view.problems');
        return;
      }
      diagnostics.clear(source);
    }
    if (code === EXIT.ok) return;

    const failure = parseFailure(result.stderr);
    const message = failure?.message ?? `seqc exited with status ${code}`;
    const detail = failure?.hint ? `${message},${failure.hint}` : message;
    const run = (command: string, ...args: unknown[]) => vscode.commands.executeCommand(command, ...args);

    switch (code) {
      case EXIT.model: {
        const choice = await vscode.window.showErrorMessage(`Seq: ${detail}`, 'Doctor', 'Pull Model', 'Rebuild');
        if (choice === 'Doctor') await run('seq.doctor', root);
        else if (choice === 'Pull Model') await run('seq.modelPull', root);
        else if (choice === 'Rebuild') await run('seq.rebuild', root);
        break;
      }
      case EXIT.compile: {
        const choice = await vscode.window.showErrorMessage(`Seq: ${detail}`, 'Compare Attempts', 'Open Attempts');
        if (choice === 'Compare Attempts') await compareLatestAttempts(root);
        else if (choice === 'Open Attempts') await run('seq.build.focus');
        break;
      }
      case EXIT.execution: {
        const choice = await vscode.window.showErrorMessage(`Seq: ${detail}`, 'Open Run Record');
        if (choice) await run('seq.openLatestRun', root);
        break;
      }
      case EXIT.filesystem: {
        // --force only helps when an output is in the way.
        const collision = builds && /--force/.test(result.stderr);
        const choice = await vscode.window.showErrorMessage(`Seq: ${detail}`, ...(collision ? ['Retry with --force'] : []));
        if (choice) {
          const confirmed = await vscode.window.showWarningMessage(
            'Replace outputs that seqc did not create, or that were edited since?',
            { modal: true },
            'Replace',
          );
          if (confirmed) await runSeqc('run', root, ['--force']);
        }
        break;
      }
      case EXIT.prerequisite: {
        const choice = await vscode.window.showErrorMessage(`Seq: ${detail}`, 'Doctor');
        if (choice) await run('seq.doctor', root);
        break;
      }
      default:
        void vscode.window.showErrorMessage(`Seq: ${detail}`);
    }
  }

  async function check(arg: unknown): Promise<void> {
    const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
    const document = uri && (await vscode.workspace.openTextDocument(uri));
    if (!document || document.languageId !== 'seq') {
      void vscode.window.showWarningMessage('Open a .seq file to check it.');
      return;
    }
    if (document.isDirty) await document.save();
    const outcome = await diagnostics.check(document, true);
    switch (outcome.kind) {
      case 'ok':
        vscode.window.setStatusBarMessage('$(check) seqc check: ok', 4000);
        break;
      case 'errors':
        await vscode.commands.executeCommand('workbench.actions.view.problems');
        break;
      case 'failed':
        void vscode.window.showErrorMessage(`Seq: ${outcome.message}`);
        break;
      case 'skipped':
        void vscode.window.showWarningMessage('seqc check needs a saved file in a trusted workspace.');
        break;
      case 'not-found':
        break;
    }
  }

  async function newProject(): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: 'New Seq Project',
      prompt: 'Project name. It becomes the directory name and the basename of the generated files.',
      validateInput: (value) =>
        /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(value)
          ? undefined
          : 'Letters, digits, underscores, and hyphens; starts with a letter or underscore; at most 64 characters.',
    });
    if (!name) return;

    const folders = vscode.workspace.workspaceFolders ?? [];
    let parent: vscode.Uri | undefined;
    if (folders.length === 1) {
      parent = folders[0].uri;
    } else {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: folders[0]?.uri,
        openLabel: 'Create Project Here',
      });
      parent = picked?.[0];
    }
    if (!parent || parent.scheme !== 'file') return;

    const result = await execSeqc(['new', name], parent.fsPath);
    if (result.notFound) return reportSeqcNotFound(true);
    if (result.code !== 0) {
      const failure = parseFailure(result.stderr);
      void vscode.window.showErrorMessage(`Seq: ${failure?.message ?? `seqc new exited with status ${result.code}`}`);
      return;
    }
    const root = vscode.Uri.joinPath(parent, name);
    await projects.discover();
    if (vscode.workspace.getWorkspaceFolder(root)) {
      await vscode.window.showTextDocument(vscode.Uri.joinPath(root, 'src', 'main.seq'));
    } else {
      const choice = await vscode.window.showInformationMessage(`Created ${root.fsPath}.`, 'Open Folder');
      if (choice) await vscode.commands.executeCommand('vscode.openFolder', root, { forceNewWindow: false });
    }
  }

  async function showArtifact(arg: unknown, pick: 'source' | 'assembly', stepIndex?: number): Promise<void> {
    const root = await resolveRoot(arg);
    if (!root) return;
    const snapshot = projects.snapshot(root);
    const file = artifactPaths(snapshot.paths, snapshot.name)[pick];
    if (!snapshot.build || !fs.existsSync(file)) {
      void vscode.window.showInformationMessage('There is no accepted build yet. Build the workflow first.');
      return;
    }
    const options: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.Beside, preview: true };
    if (pick === 'source' && typeof stepIndex === 'number') {
      const line = stepFunctionLines(fs.readFileSync(file, 'utf8')).get(stepIndex);
      if (line !== undefined) options.selection = new vscode.Range(line, 0, line, 0);
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file), options);
  }

  async function showPlan(arg: unknown): Promise<void> {
    const root = await resolveRoot(arg);
    if (!root) return;
    const snapshot = projects.snapshot(root);
    // The plan of the accepted build is recorded in the run that produced it.
    const candidates = [snapshot.build?.run_id, snapshot.latestRun?.id]
      .filter((id): id is string => !!id)
      .map((id) => path.join(snapshot.paths.runs, id, 'plan.json'));
    const file = candidates.find((candidate) => fs.existsSync(candidate)) ?? (snapshot.build ? snapshot.paths.buildFile : undefined);
    if (!file) {
      void vscode.window.showInformationMessage('There is no plan yet. Build the workflow first.');
      return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }

  async function openLatestRun(arg: unknown): Promise<void> {
    const root = await resolveRoot(arg);
    if (!root) return;
    const snapshot = projects.snapshot(root);
    const run = snapshot.latestRun;
    if (!run) {
      void vscode.window.showInformationMessage('This workflow has not been run yet.');
      return;
    }
    const manifest = path.join(snapshot.paths.runs, run.id, 'run-manifest.json');
    await vscode.window.showTextDocument(vscode.Uri.file(manifest), { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }

  async function diffAttempts(dir: string): Promise<void> {
    const label = parseAttemptLabel(path.basename(dir));
    if (!label || label.number < 2) return;
    const previousDir = path.join(path.dirname(dir), `${label.kind}-${label.number - 1}`);
    const left = attemptSource({ kind: label.kind, dir: previousDir });
    const right = attemptSource({ kind: label.kind, dir });
    if (!left || !right) {
      void vscode.window.showInformationMessage('Both attempts need a source file to compare.');
      return;
    }
    const title = `${label.kind}-${label.number - 1} ↔ ${label.kind}-${label.number}`;
    await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(left), vscode.Uri.file(right), title);
  }

  /** Compares the last two program attempts of the newest run. */
  async function compareLatestAttempts(root: string): Promise<void> {
    const snapshot = projects.snapshot(root);
    const [latest] = fs.existsSync(snapshot.paths.runs) ? fs.readdirSync(snapshot.paths.runs).sort().reverse() : [];
    const attempts = latest
      ? listAttempts(path.join(snapshot.paths.runs, latest)).filter((attempt) => attempt.kind === 'generate')
      : [];
    const last = attempts[attempts.length - 1];
    if (!last || last.number < 2) {
      await vscode.commands.executeCommand('seq.build.focus');
      return;
    }
    await diffAttempts(last.dir);
  }

  async function confirmThenRun(command: SeqcCommand, arg: unknown, message: string, action: string): Promise<void> {
    const root = await resolveRoot(arg);
    if (!root) return;
    const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
    if (choice) await runSeqc(command, root);
  }

  async function showSettings(): Promise<void> {
    const cwd = projects.current() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const result = await execSeqc(['--settings'], cwd);
    if (result.notFound) return reportSeqcNotFound(true);
    const channel = outputChannel();
    channel.appendLine(result.stdout || result.stderr);
    channel.show(true);
  }

  const register = (id: string, handler: (...args: unknown[]) => unknown) => vscode.commands.registerCommand(id, handler);
  const nodePath = (node: unknown): string | undefined => {
    const candidate = node as Node | undefined;
    if (!candidate) return undefined;
    if (candidate.kind === 'run') return candidate.dir;
    if (candidate.kind === 'dir' || candidate.kind === 'file') return candidate.path;
    return undefined;
  };

  return vscode.Disposable.from(
    register('seq.run', (arg) => runSeqc('run', arg)),
    register('seq.buildOnly', (arg) => runSeqc('build', arg)),
    register('seq.rebuild', (arg) => runSeqc('rebuild', arg)),
    register('seq.check', (arg) => check(arg)),
    register('seq.newProject', () => newProject()),
    register('seq.doctor', (arg) => runSeqc('doctor', arg)),
    register('seq.modelPull', (arg) =>
      confirmThenRun(
        'modelPull',
        arg,
        'Download the model of this project? The reference model is about 1.1 GB.',
        'Download',
      ),
    ),
    register('seq.clean', (arg) => runSeqc('clean', arg)),
    register('seq.cleanAll', (arg) =>
      confirmThenRun(
        'cleanAll',
        arg,
        'Remove the run records and the build artifacts? The next run will build again with the model. Published outputs and input/ are kept.',
        'Clean All',
      ),
    ),
    register('seq.showGeneratedC', (arg, stepIndex) =>
      showArtifact(arg, 'source', typeof stepIndex === 'number' ? stepIndex : undefined),
    ),
    register('seq.showAssembly', (arg) => showArtifact(arg, 'assembly')),
    register('seq.showPlan', (arg) => showPlan(arg)),
    register('seq.openLatestRun', (arg) => openLatestRun(arg)),
    register('seq.compareAttempts', (node) => {
      const dir = nodePath(node);
      return dir ? diffAttempts(dir) : undefined;
    }),
    register('seq.showSettings', () => showSettings()),
    register('seq.refreshBuildView', () => projects.discover()),
    register('seq.revealInExplorer', (node) => {
      const target = nodePath(node);
      if (!target) return undefined;
      const uri = vscode.Uri.file(target);
      return vscode.commands.executeCommand(vscode.workspace.getWorkspaceFolder(uri) ? 'revealInExplorer' : 'revealFileInOS', uri);
    }),
  );
}
