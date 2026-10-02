# Seq Language for VS Code

Syntax, diagnostics, and build inspection for the [Seq programming language](https://tomjnet.github.io/seq-lang/),ordered workflows written as plain-language requests and compiled by `seqc` into native executables.

```seq
model("https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct")
backend.C()
name = "top3Company"

step step1():
    ask("create a database file company.txt with 5 sample stock transactions")

step step2():
    ask("for each transaction created give me the total revenue of the company")
```

## Features

**Editing**

- Syntax highlighting for `.seq` files, with escapes and tabs marked as invalid
- Outline, breadcrumbs, and folding per step
- Completion for the header declarations, `step`, and `ask()`
- Hover documentation for every keyword, and the byte count of a request against the 4096-byte limit
- Snippets: `workflow`, `header`, `step`, `ask`
- Format Document: indentation normalized to 0 or 4 spaces, trailing whitespace removed
- Rename a step (F2)

**Diagnostics**

- `seqc check` runs when a `.seq` file is opened or saved; every error appears in Problems with its code (linked to the language reference) and its hint
- Quick fixes for the usual slips: `ask "x"` → `ask("x")`, `model = "…"` → `model("…")`, `backend = "c"` → `backend.C()`, tabs and wrong indentation, missing header declarations, duplicate step names, step parameters

**Running**

- `Seq: Run Workflow`, `Build Only`, `Rebuild`, `Check`, `Doctor`, `Pull Model`, `Clean`,each runs `seqc` in a task terminal
- Run button in the editor title, and CodeLens above the workflow: Run · Build only · Check · Rebuild · build status
- The status bar follows the build stages (`plan`, `generate`, `compile`, `test`, `run`)
- A failed build offers the next step: compare repair attempts, run `seqc doctor`, pull the model, retry with `--force`
- `seqc` tasks (`run`, `build`, `check`) for `tasks.json`, and a `$seqc` problem matcher

**Build inspection**

- CodeLens above each step: the result of the last run, a jump to its generated C function (`seq_step_N`), and what the plan says it reads and writes
- The **Seq Build** view in the Explorer: the accepted build (generated C with one entry per step function, assembly, tests, `build.json`), the published outputs, and every run record with its plan, attempts, logs, and manifests
- Compare a repair attempt with the previous one in the diff editor
- JSON schemas for `build.json`, `plan.json`, and `run-manifest.json`

The extension never writes under `output/`. What it shows is what `seqc` left on disk.

## Requirements

- [`seqc`](https://tomjnet.github.io/seq-lang/learn/#install) 0.1 on the PATH (or set `seq.seqcPath`). Without it, editing features still work; diagnostics and the run commands need it.
- `seqc` builds and runs workflows on Linux x86_64 only. On Windows, either open the project in a [Remote – WSL](https://code.visualstudio.com/docs/remote/wsl) window (recommended), or set `seq.useWsl` to run the `seqc` of your default WSL distribution from a Windows window.
- Running `seqc` is disabled in untrusted workspaces.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `seq.seqcPath` | `seqc` | Path to the `seqc` executable. `~/.local/bin/seqc` is tried when `seqc` is not on the PATH. |
| `seq.useWsl` | `false` | Windows only: run `seqc` inside the default WSL distribution. |
| `seq.check.onSave` | `true` | Run `seqc check` when a `.seq` file is opened or saved. |
| `seq.codeLens.enabled` | `true` | Show run, status, and generated-code lenses. |
| `seq.run.extraArgs` | `[]` | Extra arguments for builds and runs, e.g. `["--set", "model.seed=7"]`. |
| `seq.run.quiet` | `false` | Pass `--quiet`. |
| `seq.trace` | `off` | Log `seqc` invocations to the Seq output channel. |

## Commands

| Command | Runs |
| --- | --- |
| Seq: Run Workflow | `seqc src/main.seq` |
| Seq: Build Only | `seqc src/main.seq --build-only` |
| Seq: Rebuild | `seqc src/main.seq --rebuild` |
| Seq: Check | `seqc check <file>` |
| Seq: New Project… | `seqc new <name>` |
| Seq: Doctor | `seqc doctor` |
| Seq: Pull Model | `seqc model pull` |
| Seq: Clean / Clean All | `seqc clean [--all]` |
| Seq: Show Generated C / Show Assembly / Show Latest Plan / Open Latest Run | opens the artifact |
| Seq: Show seqc Settings | `seqc --settings` |

`seqc` builds `<project>/src/main.seq`; a `.seq` file elsewhere can be checked but not built.

## Development

```bash
npm install
npm run build          # bundle to dist/extension.js
npm test               # unit tests (vitest) and grammar snapshots
npm run test:integration   # runs inside a downloaded VS Code
SEQ_E2E=1 npm run test:integration   # also checks a file with a real seqc
```

Press F5 in VS Code to launch the extension against `tests/fixtures/project`, a recorded project with an accepted build and two run records.

## License

MIT. Seq itself is at [github.com/tomjnet/seq-lang](https://github.com/tomjnet/seq-lang).
