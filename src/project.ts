// The Seq projects in the workspace and what seqc last wrote for each.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  type BuildManifest,
  type LatestRun,
  type ProjectPaths,
  latestExecutedRun,
  projectPaths,
  projectRootOf,
  readBuild,
} from './core/records';

export interface ProjectSnapshot {
  paths: ProjectPaths;
  /** The workflow name of the accepted build, else the directory name. */
  name: string;
  /** Present only for an accepted, complete build. */
  build?: BuildManifest;
  /** The newest run that executed the program. */
  latestRun?: LatestRun;
}

export class Projects implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  private roots: string[] = [];
  private lastUsed: string | undefined;
  private readonly snapshots = new Map<string, ProjectSnapshot>();
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor() {
    const sources = vscode.workspace.createFileSystemWatcher('**/src/main.seq', false, true, false);
    sources.onDidCreate(() => void this.discover());
    sources.onDidDelete(() => void this.discover());

    const artifacts = vscode.workspace.createFileSystemWatcher('**/output/**');
    const invalidate = () => this.invalidate();
    artifacts.onDidCreate(invalidate);
    artifacts.onDidChange(invalidate);
    artifacts.onDidDelete(invalidate);

    this.disposables.push(
      sources,
      artifacts,
      this.changed,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discover()),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const root = editor && this.rootFor(editor.document.uri);
        if (root) this.lastUsed = root;
      }),
    );
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const item of this.disposables) item.dispose();
  }

  async discover(): Promise<void> {
    const found = await vscode.workspace.findFiles('**/src/main.seq', '**/{node_modules,.git,output}/**', 50);
    const roots = new Set<string>();
    for (const uri of found) {
      const root = uri.scheme === 'file' ? projectRootOf(uri.fsPath) : undefined;
      if (root) roots.add(root);
    }
    // A project opened as a single file is still a project.
    for (const document of vscode.workspace.textDocuments) {
      const root = this.rootFor(document.uri);
      if (root) roots.add(root);
    }
    this.roots = [...roots].sort();
    await vscode.commands.executeCommand('setContext', 'seq.hasProject', this.roots.length > 0);
    this.refresh();
  }

  /** Drops what was read from disk and tells every view to redraw. */
  refresh(): void {
    this.snapshots.clear();
    this.changed.fire();
  }

  private invalidate(): void {
    // A build writes many files in a burst; one redraw at the end is enough.
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 300);
  }

  all(): string[] {
    return this.roots;
  }

  rootFor(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== 'file') return undefined;
    const root = projectRootOf(uri.fsPath);
    return root && fs.existsSync(path.join(root, 'src', 'main.seq')) ? root : undefined;
  }

  /** The project a command without arguments should act on. */
  current(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    const fromEditor = editor && this.rootFor(editor.document.uri);
    if (fromEditor) return fromEditor;
    if (editor?.document.uri.scheme === 'file') {
      // A generated file or a run record of a project counts as that project.
      const file = editor.document.uri.fsPath;
      const owner = this.roots.find((root) => file.startsWith(root + path.sep));
      if (owner) return owner;
    }
    if (this.lastUsed && this.roots.includes(this.lastUsed)) return this.lastUsed;
    return this.roots.length === 1 ? this.roots[0] : undefined;
  }

  markUsed(root: string): void {
    this.lastUsed = root;
  }

  snapshot(root: string): ProjectSnapshot {
    let snapshot = this.snapshots.get(root);
    if (!snapshot) {
      const paths = projectPaths(root);
      const build = readBuild(paths);
      snapshot = {
        paths,
        name: build?.workflow ?? path.basename(root),
        build,
        latestRun: latestExecutedRun(paths),
      };
      this.snapshots.set(root, snapshot);
    }
    return snapshot;
  }
}
