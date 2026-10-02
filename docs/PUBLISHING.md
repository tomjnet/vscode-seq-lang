# Uploading and publishing

Development happens in this private checkout. Three things get uploaded, in
this order: the code to GitHub, the extension to the Marketplace, and
(optionally) the extension to Open VSX.

## 1. Push the code to GitHub

The manifest already points at `https://github.com/tomjnet/vscode-seq-lang`.

**Create the repository (web UI).** Go to <https://github.com/new>:

- Owner `tomjnet`, name `vscode-seq-lang`
- Public or private as you prefer (the Marketplace does not need the repository to be public)
- Leave "Add a README", ".gitignore", and "license" **unchecked**,this checkout has them

Then, on the repository page, "⚙ Settings" next to *About* (right column):

- Description: `Syntax, diagnostics, and build inspection for the Seq programming language.`
- Website: `https://tomjnet.github.io/seq-lang/`
- Topics: `vscode-extension seq-lang seqc programming-language language-support llm compiler codelens`

**Push from this folder.** Run these once, from `D:\github_tomjnet\vscode-seq-lang-private`:

```bash
git init -b main
```

```bash
git add -A
```

```bash
git commit -m "Seq Language for VS Code 0.1.0"
```

```bash
git remote add origin https://github.com/tomjnet/vscode-seq-lang.git
```

```bash
git push -u origin main
```

The `output/` directory of the fixture project is committed on purpose: it is
the recorded build the tests and the F5 launch use.

If the GitHub CLI is installed later, the About fields can be set in one go:

```bash
gh repo edit tomjnet/vscode-seq-lang --description "Syntax, diagnostics, and build inspection for the Seq programming language." --homepage "https://tomjnet.github.io/seq-lang/" --add-topic vscode-extension,seq-lang,seqc,programming-language,language-support,llm,compiler,codelens
```

## 2. Publish to the Visual Studio Marketplace

Done once:

1. Create the publisher `tomjnet` at <https://marketplace.visualstudio.com/manage> (sign in with a Microsoft account). The publisher ID must be exactly `tomjnet`, the value of `"publisher"` in `package.json`.
2. Create a Personal Access Token at <https://dev.azure.com> → User settings → Personal access tokens → New Token: Organization **All accessible organizations**, Scopes **Custom defined** → Marketplace **Manage**. Copy it; it is shown once.

For every release:

```bash
npm version 0.1.0 --no-git-tag-version
```

(adjust the version; also add an entry to `CHANGELOG.md`), then either

**Command line:**

```bash
npx vsce login tomjnet
```

(pastes the token once and keeps it), then

```bash
npx vsce publish
```

**Or the web UI:** build the package

```bash
npx vsce package
```

and at <https://marketplace.visualstudio.com/manage/publishers/tomjnet> click **+ New extension → Visual Studio Code**, drop the `vscode-seq-lang-0.1.0.vsix` file. Updates use the **…** menu → **Update** on the extension's row.

The listing goes live a few minutes after verification. From then on:

```bash
code --install-extension tomjnet.vscode-seq-lang
```

**Or from CI:** add the token as the repository secret `VSCE_PAT` (Settings → Secrets and variables → Actions), then tag a release:

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

`.github/workflows/release.yml` packages, publishes, and attaches the `.vsix` to a GitHub release. The tag must equal `v` + the version in `package.json`.

## 3. Open VSX (Cursor, VSCodium, Gitpod, Theia)

Optional. Create an account and the `tomjnet` namespace at <https://open-vsx.org>, generate an access token under your profile, then:

```bash
npx ovsx publish vscode-seq-lang-0.1.0.vsix -p <token>
```

or add the token as the `OVSX_PAT` secret and the release workflow does it.

## Before the first publish

- [ ] `npm run typecheck && npm run lint && npm test && npm run test:integration` are green
- [ ] `npx vsce package` succeeds and `npx vsce ls` lists only the files that belong in the package
- [ ] `CHANGELOG.md` has an entry for the version
- [ ] A screenshot or GIF in `images/` and in the README (the Marketplace page is the README)
- [ ] The `tomjnet` publisher exists on the Marketplace
