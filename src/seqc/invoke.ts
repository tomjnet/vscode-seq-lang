// How seqc is found and started. Every spawn in the extension goes through
// seqcInvocation(), so the WSL bridge and the path setting live in one place.

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { INSTALL_URL } from '../core/codes';

export interface Invocation {
  command: string;
  args: string[];
  /** What to show the user: "seqc check src/main.seq". */
  display: string;
}

export interface ExecResult {
  /** null when the process was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  notFound: boolean;
}

let channel: vscode.OutputChannel | undefined;

export function outputChannel(): vscode.OutputChannel {
  channel ??= vscode.window.createOutputChannel('Seq');
  return channel;
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('seq');
}

export function usesWsl(): boolean {
  return process.platform === 'win32' && config().get<boolean>('useWsl', false);
}

function onPath(name: string): boolean {
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      if (fs.existsSync(path.join(dir, name + ext))) return true;
    }
  }
  return false;
}

function nativeSeqcPath(): string {
  const configured = config().get<string>('seqcPath', 'seqc').trim() || 'seqc';
  if (configured.startsWith('~/')) return path.join(os.homedir(), configured.slice(2));
  if (configured !== 'seqc' || onPath('seqc')) return configured;
  // The installer puts seqc in ~/.local/bin, which is not always on the PATH
  // an editor was started with.
  const fallback = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'seqc.exe' : 'seqc');
  return fs.existsSync(fallback) ? fallback : configured;
}

export function seqcInvocation(args: string[]): Invocation {
  const display = ['seqc', ...args].join(' ');
  if (usesWsl()) {
    // A login shell, so that ~/.local/bin is on the PATH. The arguments are
    // passed as positional parameters and never interpreted by the shell.
    const seqc = config().get<string>('seqcPath', 'seqc').trim() || 'seqc';
    return { command: 'wsl.exe', args: ['-e', 'bash', '-lc', 'exec "$0" "$@"', seqc, ...args], display };
  }
  return { command: nativeSeqcPath(), args, display };
}

/** True when a finished process means "seqc is not installed" rather than a seqc result. */
export function isNotFound(error: { code?: string | number | null } | null, code: number | null): boolean {
  if (error?.code === 'ENOENT') return true;
  // Inside WSL the shell starts, and reports the missing command with 127.
  return usesWsl() && code === 127;
}

export function trace(invocation: Invocation, cwd: string): void {
  if (config().get<string>('trace', 'off') === 'off') return;
  outputChannel().appendLine(`[${new Date().toISOString()}] ${invocation.display}  (cwd: ${cwd})`);
}

/** Runs seqc to completion and captures its output. For short commands such as `check`. */
export function execSeqc(args: string[], cwd: string, token?: vscode.CancellationToken): Promise<ExecResult> {
  const invocation = seqcInvocation(args);
  trace(invocation, cwd);
  return new Promise((resolve) => {
    const child = execFile(
      invocation.command,
      invocation.args,
      { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, NO_COLOR: '1' } },
      (error, stdout, stderr) => {
        // error.code is the exit status, or a string such as ENOENT when
        // the process could not be started.
        const failure = error as { code?: string | number | null } | null;
        const code = failure === null ? 0 : typeof failure.code === 'number' ? failure.code : null;
        resolve({ code, stdout, stderr, notFound: isNotFound(failure, code) });
      },
    );
    token?.onCancellationRequested(() => child.kill());
  });
}

let notFoundShown = false;

/**
 * Tells the user that seqc could not be started. Shown once per session unless
 * the user asked for the command that failed.
 */
export async function reportSeqcNotFound(explicit: boolean): Promise<void> {
  if (notFoundShown && !explicit) return;
  notFoundShown = true;

  const install = 'Install Instructions';
  const setPath = 'Set Path';
  const useWsl = 'Use seqc from WSL';
  const canOfferWsl = process.platform === 'win32' && !usesWsl();
  const message = usesWsl()
    ? 'seqc was not found in the default WSL distribution.'
    : canOfferWsl
      ? 'seqc was not found. On Windows, seqc builds and runs workflows inside WSL2.'
      : 'seqc was not found.';
  const choice = await vscode.window.showWarningMessage(message, ...(canOfferWsl ? [useWsl] : []), install, setPath);
  if (choice === install) {
    await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
  } else if (choice === setPath) {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'seq.seqcPath');
  } else if (choice === useWsl) {
    await config().update('useWsl', true, vscode.ConfigurationTarget.Global);
    notFoundShown = false;
  }
}
