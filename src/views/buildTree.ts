// The "Seq Build" view: a read-only look at output/ of each project. The
// accepted build, the published outputs, and every run record are shown as
// seqc left them on disk.

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  artifactPaths,
  describeTests,
  listRuns,
  parseAttemptLabel,
  readRunManifest,
  relativeTime,
  runTime,
  stepFunctionLines,
} from '../core/records';
import type { ProjectSnapshot, Projects } from '../project';

const MAX_RUNS = 50;
const MAX_ENTRIES = 200;
const BINARY_EXTENSIONS = new Set(['.bin', '.o', '.gguf']);

export type Node =
  | { kind: 'project'; root: string }
  | { kind: 'build'; root: string }
  | { kind: 'outputs'; root: string }
  | { kind: 'runs'; root: string }
  | { kind: 'run'; root: string; id: string; dir: string }
  | { kind: 'dir'; path: string }
  | { kind: 'file'; path: string; label?: string; description?: string }
  | { kind: 'function'; path: string; index: number; name: string; line: number }
  | { kind: 'message'; text: string };

export class BuildTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly projects: Projects) {
    this.subscription = projects.onDidChange(() => this.changed.fire());
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const roots = this.projects.all();
      // With one project its sections are the top level.
      return roots.length === 1 ? this.sections(roots[0]) : roots.map((root) => ({ kind: 'project', root }));
    }
    switch (node.kind) {
      case 'project':
        return this.sections(node.root);
      case 'build':
        return this.buildChildren(this.projects.snapshot(node.root));
      case 'outputs':
        return this.outputChildren(this.projects.snapshot(node.root));
      case 'runs':
        return this.runChildren(this.projects.snapshot(node.root));
      case 'run':
      case 'dir':
        return this.directoryChildren(node.kind === 'run' ? node.dir : node.path);
      case 'file':
        return this.functionChildren(node.path);
      default:
        return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'project': {
        const snapshot = this.projects.snapshot(node.root);
        const item = new vscode.TreeItem(snapshot.name, vscode.TreeItemCollapsibleState.Expanded);
        item.description = vscode.workspace.asRelativePath(node.root);
        item.iconPath = new vscode.ThemeIcon('project');
        return item;
      }
      case 'build': {
        const build = this.projects.snapshot(node.root).build;
        const item = new vscode.TreeItem(
          'Build',
          build ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon(build ? 'pass' : 'circle-outline');
        item.description = build ? this.describeBuild(build) : 'no accepted build';
        return item;
      }
      case 'outputs': {
        const item = new vscode.TreeItem('Outputs', vscode.TreeItemCollapsibleState.Collapsed);
        item.iconPath = new vscode.ThemeIcon('output');
        item.description = 'published files';
        return item;
      }
      case 'runs': {
        const count = listRuns(this.projects.snapshot(node.root).paths).length;
        const item = new vscode.TreeItem(
          'Runs',
          count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon('history');
        item.description = count === 0 ? 'none' : `${count}`;
        return item;
      }
      case 'run':
        return this.runItem(node);
      case 'dir': {
        const item = new vscode.TreeItem(vscode.Uri.file(node.path), vscode.TreeItemCollapsibleState.Collapsed);
        const attempt = parseAttemptLabel(path.basename(node.path));
        // generate-2 and later can be compared with the attempt before.
        item.contextValue = attempt && attempt.number > 1 ? 'seq.attempt.comparable' : attempt ? 'seq.attempt' : 'seq.dir';
        return item;
      }
      case 'file': {
        const uri = vscode.Uri.file(node.path);
        const expandable = node.path.endsWith('.c') && this.functionChildren(node.path).length > 0;
        const item = new vscode.TreeItem(
          uri,
          expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
        );
        if (node.label) item.label = node.label;
        item.description = node.description;
        item.contextValue = 'seq.file';
        if (!BINARY_EXTENSIONS.has(path.extname(node.path))) {
          item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
        } else {
          item.tooltip = `${node.path} (binary)`;
        }
        return item;
      }
      case 'function': {
        const item = new vscode.TreeItem(`seq_step_${node.index}`, vscode.TreeItemCollapsibleState.None);
        item.description = node.name;
        item.iconPath = new vscode.ThemeIcon('symbol-function');
        const selection = new vscode.Range(node.line, 0, node.line, 0);
        item.command = {
          command: 'vscode.open',
          title: 'Open',
          arguments: [vscode.Uri.file(node.path), { selection } satisfies vscode.TextDocumentShowOptions],
        };
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
    }
  }

  private sections(root: string): Node[] {
    return [
      { kind: 'build', root },
      { kind: 'outputs', root },
      { kind: 'runs', root },
    ];
  }

  private describeBuild(build: NonNullable<ProjectSnapshot['build']>): string {
    const parts: string[] = [];
    const created = build.created ? new Date(build.created) : undefined;
    parts.push(created && !Number.isNaN(created.getTime()) ? `accepted ${relativeTime(created)}` : 'accepted');
    const steps = build.plan?.steps?.length;
    if (steps) parts.push(`${steps} step${steps === 1 ? '' : 's'}`);
    const tests = describeTests(build);
    if (tests) parts.push(tests);
    const attempts = build.attempts?.program;
    if (attempts && attempts > 1) parts.push(`${attempts - 1} repair${attempts === 2 ? '' : 's'}`);
    return parts.join(' · ');
  }

  private buildChildren(snapshot: ProjectSnapshot): Node[] {
    if (!snapshot.build) return [];
    const artifacts = artifactPaths(snapshot.paths, snapshot.name);
    const entries: [string, string][] = [
      [artifacts.source, 'generated program'],
      [artifacts.assembly, 'assembly, -O3'],
      [artifacts.binary, 'executable'],
      [artifacts.testSource, 'generated tests'],
      [snapshot.paths.buildFile, 'build manifest'],
    ];
    return entries
      .filter(([file]) => fs.existsSync(file))
      .map(([file, description]) => ({
        kind: 'file',
        path: file,
        label: path.relative(snapshot.paths.temp, file).split(path.sep).join('/'),
        description,
      }));
  }

  private functionChildren(file: string): Node[] {
    if (!file.endsWith('.c')) return [];
    let source: string;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    const names = new Map<number, string>();
    // The driver table at the end of the unit pairs each function with its step name.
    for (const m of source.matchAll(/\{"([^"]*)",\s*seq_step_(\d+)\}/g)) names.set(Number(m[2]), m[1]);
    return [...stepFunctionLines(source)]
      .sort(([a], [b]) => a - b)
      .map(([index, line]) => ({ kind: 'function', path: file, index, name: names.get(index) ?? '', line }));
  }

  private outputChildren(snapshot: ProjectSnapshot): Node[] {
    const children = this.directoryChildren(snapshot.paths.output).filter(
      (node) => !(node.kind === 'dir' && node.path === snapshot.paths.temp),
    );
    return children.length > 0 ? children : [{ kind: 'message', text: 'Nothing published yet' }];
  }

  private runChildren(snapshot: ProjectSnapshot): Node[] {
    const runs = listRuns(snapshot.paths);
    const nodes: Node[] = runs
      .slice(0, MAX_RUNS)
      .map((id) => ({ kind: 'run', root: snapshot.paths.root, id, dir: path.join(snapshot.paths.runs, id) }));
    if (runs.length > MAX_RUNS) {
      nodes.push({ kind: 'message', text: `${runs.length - MAX_RUNS} older runs not shown` });
    }
    return nodes;
  }

  private runItem(node: Extract<Node, { kind: 'run' }>): vscode.TreeItem {
    const snapshot = this.projects.snapshot(node.root);
    const manifest = readRunManifest(snapshot.paths, node.id);
    const time = runTime(node.id);
    const item = new vscode.TreeItem(
      time ? time.toLocaleString() : node.id,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.tooltip = node.id;
    item.contextValue = 'seq.dir';
    item.resourceUri = vscode.Uri.file(node.dir);
    if (!manifest) {
      // No run manifest: the run stopped before the program was executed
      // (build only, or the build did not succeed).
      const built = fs.existsSync(path.join(node.dir, 'build-manifest.json'));
      item.iconPath = new vscode.ThemeIcon(built ? 'package' : 'circle-slash');
      item.description = built ? 'built, not run' : 'not built';
      return item;
    }
    const ok = manifest.status === 'ok';
    item.iconPath = new vscode.ThemeIcon(
      ok ? 'pass' : 'error',
      new vscode.ThemeColor(ok ? 'testing.iconPassed' : 'testing.iconFailed'),
    );
    const parts = [manifest.status ?? 'unknown'];
    if (manifest.reused_cached_build) parts.push('cached build');
    if (typeof manifest.seconds === 'number') parts.push(`${manifest.seconds.toFixed(1)} s`);
    item.description = parts.join(' · ');
    return item;
  }

  private directoryChildren(dir: string): Node[] {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [{ kind: 'message', text: 'Cannot read this directory' }];
    }
    const nodes: Node[] = entries
      .filter((entry) => entry.name !== '.gitignore' && entry.name !== '.seqc.lock')
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true }))
      .slice(0, MAX_ENTRIES)
      .map((entry) =>
        entry.isDirectory() ? { kind: 'dir', path: path.join(dir, entry.name) } : { kind: 'file', path: path.join(dir, entry.name) },
      );
    return nodes;
  }
}
