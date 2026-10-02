// One status-bar item: the stage seqc is in while it runs, and how the last
// command ended.

import * as vscode from 'vscode';
import type { SeqcCommand, SeqcFinished, SeqcTasks } from './seqc/tasks';

const EXIT_LABELS: Record<number, string> = {
  1: 'internal error',
  2: 'bad command line or setting',
  3: 'invalid workflow',
  4: 'model error',
  5: 'generated program rejected',
  6: 'run failed',
  7: 'filesystem or sandbox',
  8: 'missing prerequisite',
  130: 'cancelled',
};

export function exitLabel(code: number): string {
  return EXIT_LABELS[code] ?? `exit status ${code}`;
}

export class SeqStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  private readonly disposables: vscode.Disposable[] = [this.item];
  private running = false;

  constructor(tasks: SeqcTasks) {
    this.item.name = 'Seq';
    this.item.command = 'seq.build.focus';
    this.disposables.push(
      tasks.onDidStart(({ command }) => this.start(command)),
      tasks.onStage(({ stage }) => {
        if (!this.running) return;
        this.item.text = `$(sync~spin) Seq: ${stage.tag}`;
        this.item.tooltip = stage.message;
      }),
      tasks.onDidFinish((result) => this.finish(result)),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateVisibility()),
    );
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  private start(command: SeqcCommand): void {
    this.running = true;
    this.item.text = `$(sync~spin) Seq: ${command}`;
    this.item.tooltip = 'seqc is running';
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  private finish(result: SeqcFinished): void {
    this.running = false;
    if (result.notFound) {
      this.item.text = '$(warning) seqc not found';
      this.item.tooltip = 'seqc could not be started';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (result.code === 0) {
      this.item.text = `$(check) Seq: ${result.command} ok`;
      this.item.tooltip = 'Show the Seq Build view';
      this.item.backgroundColor = undefined;
    } else if (result.code === undefined || result.code === 130) {
      this.item.text = '$(circle-slash) Seq: cancelled';
      this.item.tooltip = undefined;
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = `$(error) Seq: ${exitLabel(result.code)}`;
      this.item.tooltip = `seqc exited with status ${result.code}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    this.updateVisibility();
  }

  private updateVisibility(): void {
    if (this.running || vscode.window.activeTextEditor?.document.languageId === 'seq') {
      if (this.item.text) this.item.show();
    } else {
      this.item.hide();
    }
  }
}
