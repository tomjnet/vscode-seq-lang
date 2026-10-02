// Needs a real seqc. Opt in with SEQ_E2E=1; on Windows seqc is taken from WSL.

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const enabled = process.env.SEQ_E2E === '1';

suite('seqc check', function () {
  if (!enabled) {
    test('skipped: set SEQ_E2E=1 to run against a real seqc', function () {
      this.skip();
    });
    return;
  }

  let dir: string;

  suiteSetup(async () => {
    if (process.platform === 'win32') {
      await vscode.workspace.getConfiguration('seq').update('useWsl', true, vscode.ConfigurationTarget.Global);
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-e2e-'));
  });

  suiteTeardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function diagnosticsOf(name: string, content: string): Promise<vscode.Diagnostic[]> {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    const uri = vscode.Uri.file(file);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    await vscode.commands.executeCommand('seq.check', uri);
    return vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'seqc');
  }

  test('publishes every error seqc reports, with the hint', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'seqc', 'several_errors.seq'), 'utf8');
    const diagnostics = await diagnosticsOf('several_errors.seq', source);
    assert.equal(diagnostics.length, 8);
    const ask = diagnostics.find((d) => typeof d.code === 'object' && d.code.value === 'E0204')!;
    assert.equal(ask.range.start.line, 11);
    assert.equal(ask.range.start.character, 8);
    assert.equal(ask.relatedInformation?.[0].message, 'hint: write ask("...")');
  });

  test('clears the diagnostics of a valid file', async () => {
    const valid = 'model("https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct")\nbackend.C()\nname = "ok"\n\nstep one():\n    ask("print hi")\n';
    assert.deepEqual(await diagnosticsOf('ok.seq', valid), []);
  });
});
