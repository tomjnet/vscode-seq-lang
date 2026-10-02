// Lenses above the workflow and above each step: run it, see how the last run
// went, and jump to what the model wrote for it.

import * as vscode from 'vscode';
import { parseOutline } from '../core/document';
import { buildFreshness, describeTests, relativeTime, runTime, type RunStep } from '../core/records';
import type { ProjectSnapshot, Projects } from '../project';
import { toRange } from './language';

export class SeqCodeLenses implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(private readonly projects: Projects) {
    this.disposables.push(
      projects.onDidChange(() => this.changed.fire()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('seq.codeLens')) this.changed.fire();
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.changed.fire()),
    );
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('seq', document).get<boolean>('codeLens.enabled', true)) return [];
    const top = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];
    const lens = (range: vscode.Range, title: string, command: string, args: unknown[] = [], tooltip?: string) =>
      lenses.push(new vscode.CodeLens(range, { title, command, arguments: args, tooltip }));

    const root = this.projects.rootFor(document.uri);
    const trusted = vscode.workspace.isTrusted;
    if (!root) {
      // Only <project>/src/main.seq can be built; any .seq file can be checked.
      if (trusted) lens(top, '$(check) Check', 'seq.check', [document.uri]);
      return lenses;
    }

    const snapshot = this.projects.snapshot(root);
    const text = document.getText();
    const freshness = buildFreshness(snapshot.build, text);
    if (trusted) {
      lens(top, '$(play) Run', 'seq.run', [root], 'seqc src/main.seq');
      lens(top, 'Build only', 'seq.buildOnly', [root], 'seqc src/main.seq --build-only');
      lens(top, 'Check', 'seq.check', [document.uri], 'seqc check src/main.seq');
      lens(top, 'Rebuild', 'seq.rebuild', [root], 'seqc src/main.seq --rebuild: ignore the build cache');
    }
    lens(top, this.buildTitle(snapshot, freshness), 'seq.build.focus', [], 'Show the Seq Build view');

    if (!snapshot.build) return lenses;
    const planned = snapshot.build.plan?.steps ?? [];
    const run = this.runOfBuild(snapshot);
    for (const step of parseOutline(text).steps) {
      // Lenses describe the accepted build. A step that was added, moved, or
      // renamed since has nothing to show until the next build.
      const plan = planned.find((item) => item.index === step.index && item.name === step.name);
      if (!plan) continue;
      const range = toRange(step.keyword);
      const status = run?.find((item) => item.index === step.index);
      if (status) {
        lens(range, this.statusTitle(status), 'seq.openLatestRun', [root], 'Open the record of the last run');
      } else if (run) {
        lens(range, '$(circle-slash) not run', 'seq.openLatestRun', [root], 'An earlier step stopped the last run');
      }
      lens(range, 'Generated C', 'seq.showGeneratedC', [root, step.index], `Open seq_step_${step.index}`);
      const io = this.planTitle(plan.reads, plan.writes);
      if (io || plan.summary) lens(range, io ?? 'Plan', 'seq.showPlan', [root], plan.summary);
    }
    return lenses;
  }

  private buildTitle(snapshot: ProjectSnapshot, freshness: ReturnType<typeof buildFreshness>): string {
    const build = snapshot.build;
    if (!build) return 'no accepted build';
    if (freshness === 'changed') return '$(warning) source changed since the last build';
    const parts = ['build accepted'];
    const created = build.created ? new Date(build.created) : build.run_id ? runTime(build.run_id) : undefined;
    if (created && !Number.isNaN(created.getTime())) parts[0] += ` ${relativeTime(created)}`;
    const tests = describeTests(build);
    if (tests) parts.push(tests);
    return `$(pass) ${parts.join(' · ')}`;
  }

  /** The step records of the latest run, when that run executed the accepted build. */
  private runOfBuild(snapshot: ProjectSnapshot): RunStep[] | undefined {
    const manifest = snapshot.latestRun?.manifest;
    if (!manifest?.steps) return undefined;
    const key = manifest.cache_key;
    if (key && snapshot.build?.cache_key && key !== snapshot.build.cache_key) return undefined;
    return manifest.steps;
  }

  private statusTitle(step: RunStep): string {
    if (step.status === 'ok') return '$(pass) ok';
    if (step.status === 'failed') {
      const message = step.message ? `: ${truncate(step.message, 60)}` : '';
      return `$(error) failed (code ${step.code ?? '?'})${message}`;
    }
    return '$(error) did not finish';
  }

  private planTitle(reads: string[] | undefined, writes: string[] | undefined): string | undefined {
    const left = reads?.length ? reads.join(', ') : '';
    const right = writes?.length ? writes.join(', ') : '';
    if (!left && !right) return undefined;
    return truncate(`${left || '∅'} → ${right || '∅'}`, 70);
  }
}

function truncate(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ');
  return single.length <= max ? single : single.slice(0, max - 1) + '…';
}
