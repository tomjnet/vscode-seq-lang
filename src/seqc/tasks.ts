// seqc as VS Code tasks. A task runs seqc in a pseudoterminal so that the
// output is shown as seqc wrote it while the extension reads the same stream
// for stage lines, diagnostics, and the exit status.

import { type ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { LineSplitter, parseStageLine, type StageLine } from '../core/seqcOutput';
import { isNotFound, seqcInvocation, trace } from './invoke';

export type SeqcCommand = 'run' | 'build' | 'rebuild' | 'check' | 'clean' | 'cleanAll' | 'doctor' | 'modelPull';

export interface SeqcTaskDefinition extends vscode.TaskDefinition {
  type: 'seqc';
  command: SeqcCommand;
  project?: string;
  args?: string[];
}

export interface SeqcFinished {
  command: SeqcCommand;
  root: string;
  /** undefined when the terminal was closed before seqc exited. */
  code: number | undefined;
  stderr: string;
  notFound: boolean;
}

const TITLES: Record<SeqcCommand, string> = {
  run: 'run',
  build: 'build',
  rebuild: 'rebuild',
  check: 'check',
  clean: 'clean',
  cleanAll: 'clean --all',
  doctor: 'doctor',
  modelPull: 'model pull',
};

const SOURCE = 'src/main.seq';

/** The seqc arguments for a command. Paths are relative to the project root, which is the working directory. */
export function seqcArgs(command: SeqcCommand, extra: readonly string[] = []): string[] {
  switch (command) {
    case 'run':
      return [SOURCE, ...extra];
    case 'build':
      return [SOURCE, '--build-only', ...extra];
    case 'rebuild':
      return [SOURCE, '--rebuild', ...extra];
    case 'check':
      return ['check', SOURCE];
    case 'clean':
      return ['clean'];
    case 'cleanAll':
      return ['clean', '--all'];
    case 'doctor':
      return ['doctor', ...extra];
    case 'modelPull':
      return ['model', 'pull', ...extra];
  }
}

function buildsOrRuns(command: SeqcCommand): boolean {
  return command === 'run' || command === 'build' || command === 'rebuild';
}

class SeqcTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  private child: ChildProcess | undefined;
  private stderr = '';
  private finished = false;

  constructor(
    private readonly command: SeqcCommand,
    private readonly root: string,
    private readonly args: string[],
    private readonly onStage: (stage: StageLine) => void,
    private readonly onFinished: (result: SeqcFinished) => void,
  ) {}

  open(): void {
    const invocation = seqcInvocation(this.args);
    trace(invocation, this.root);
    this.write(`\x1b[2m> ${invocation.display}\x1b[0m\n\n`);

    const stdoutLines = new LineSplitter();
    const child = spawn(invocation.command, invocation.args, {
      cwd: this.root,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' },
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.write(chunk);
      for (const line of stdoutLines.push(chunk)) {
        const stage = parseStageLine(line);
        if (stage) this.onStage(stage);
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      this.stderr += chunk;
      this.write(chunk);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      const notFound = isNotFound(error, null);
      this.write(notFound ? 'seqc was not found.\n' : `seqc could not be started: ${error.message}\n`);
      this.finish(127, notFound);
    });
    child.on('close', (code, signal) => {
      if (code === null) this.write(`\nseqc was stopped (${signal ?? 'killed'}).\n`);
      this.finish(code ?? 130, isNotFound(null, code));
    });
  }

  close(): void {
    // The terminal was closed or the task was terminated.
    if (this.finished) return;
    this.finished = true;
    this.child?.kill('SIGINT');
    this.onFinished({ command: this.command, root: this.root, code: undefined, stderr: this.stderr, notFound: false });
  }

  handleInput(data: string): void {
    if (data === '\x03') this.child?.kill('SIGINT');
  }

  private write(text: string): void {
    this.writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));
  }

  private finish(code: number, notFound: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.onFinished({ command: this.command, root: this.root, code, stderr: this.stderr, notFound });
    this.closeEmitter.fire(code);
  }
}

export class SeqcTasks implements vscode.TaskProvider, vscode.Disposable {
  static readonly type = 'seqc';

  private readonly stage = new vscode.EventEmitter<{ root: string; command: SeqcCommand; stage: StageLine }>();
  private readonly started = new vscode.EventEmitter<{ root: string; command: SeqcCommand }>();
  private readonly finished = new vscode.EventEmitter<SeqcFinished>();
  readonly onStage = this.stage.event;
  readonly onDidStart = this.started.event;
  readonly onDidFinish = this.finished.event;

  constructor(private readonly projectRoots: () => string[]) {}

  dispose(): void {
    this.stage.dispose();
    this.started.dispose();
    this.finished.dispose();
  }

  provideTasks(): vscode.Task[] {
    const tasks: vscode.Task[] = [];
    for (const root of this.projectRoots()) {
      // In tasks.json a project is written relative to its workspace folder.
      const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
      const relative = folder ? path.relative(folder.uri.fsPath, root).split(path.sep).join('/') : root;
      for (const command of ['run', 'build', 'check'] as const) {
        const definition: SeqcTaskDefinition = { type: 'seqc', command };
        if (relative !== '') definition.project = relative;
        tasks.push(this.createTask(definition, root));
      }
    }
    return tasks;
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as SeqcTaskDefinition;
    if (!definition.command || !(definition.command in TITLES)) return undefined;
    const folder = typeof task.scope === 'object' ? task.scope : vscode.workspace.workspaceFolders?.[0];
    const base = folder?.uri.fsPath;
    const root = definition.project
      ? path.isAbsolute(definition.project)
        ? definition.project
        : base && path.join(base, definition.project)
      : base;
    if (!root) return undefined;
    return this.createTask(definition, root, task.scope);
  }

  /** Starts seqc and resolves when it exits. */
  async run(command: SeqcCommand, root: string, extra: readonly string[] = []): Promise<SeqcFinished> {
    const configured = buildsOrRuns(command) ? this.configuredArgs() : [];
    const task = this.createTask({ type: 'seqc', command, args: [...configured, ...extra] }, root);
    const done = new Promise<SeqcFinished>((resolve) => {
      const subscription = this.onDidFinish((result) => {
        if (result.root === root && result.command === command) {
          subscription.dispose();
          resolve(result);
        }
      });
    });
    await vscode.tasks.executeTask(task);
    return done;
  }

  private configuredArgs(): string[] {
    const config = vscode.workspace.getConfiguration('seq');
    const args = [...config.get<string[]>('run.extraArgs', [])];
    if (config.get<boolean>('run.quiet', false)) args.push('--quiet');
    return args;
  }

  private createTask(definition: SeqcTaskDefinition, root: string, scope?: vscode.Task['scope']): vscode.Task {
    const command = definition.command;
    const args = seqcArgs(command, definition.args ?? []);
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
    const execution = new vscode.CustomExecution(async () => {
      this.started.fire({ root, command });
      return new SeqcTerminal(
        command,
        root,
        args,
        (stage) => this.stage.fire({ root, command, stage }),
        (result) => this.finished.fire(result),
      );
    });
    const task = new vscode.Task(
      definition,
      scope ?? folder ?? vscode.TaskScope.Workspace,
      TITLES[command],
      SeqcTasks.type,
      execution,
      [],
    );
    task.presentationOptions = {
      reveal: command === 'check' ? vscode.TaskRevealKind.Silent : vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
      clear: true,
      showReuseMessage: false,
    };
    if (command === 'build') task.group = vscode.TaskGroup.Build;
    return task;
  }
}
