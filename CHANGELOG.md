# Changelog

## 0.1.0

First release, for seq-lang 0.1 (grammar version 1).

- Syntax highlighting, snippets, outline, folding, completion, hover, document links, formatting, and step rename
- Diagnostics from `seqc check` on open and save, with hints and quick fixes
- Commands and tasks for `seqc` run, build, rebuild, check, new, doctor, model pull, and clean; status-bar stage indicator; exit-code guidance
- CodeLens above the workflow and each step: run, build status, last-run result, generated C, plan
- Seq Build view: accepted build artifacts, published outputs, run records, attempt comparison
- JSON schemas for `build.json`, `plan.json`, and `run-manifest.json`
- Windows: `seq.useWsl` runs `seqc` from the default WSL distribution
