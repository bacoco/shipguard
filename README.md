# e2e-agent-browser

**Turn agent-browser into a persistent, self-maintaining test suite.**

[agent-browser](https://github.com/nicobailey/agent-browser) gives you a powerful CLI to control a browser: `click`, `fill`, `snapshot`, `screenshot`, `upload`. You can test anything, interactively, one command at a time.

This plugin adds **what agent-browser doesn't do**: remembering tests, running them again, tracking what broke, fixing what changed, and building coverage over time.

---

## What agent-browser does

```bash
agent-browser open http://localhost:3000
agent-browser snapshot                      # get the accessibility tree
agent-browser click e4                      # click a button by ref
agent-browser fill e16 "my query"           # fill an input
agent-browser screenshot /tmp/result.png    # capture the screen
```

Great for one-off exploration and debugging. But next week, you won't remember what you tested or what refs to use.

## What this plugin adds

```bash
/e2e-run I just changed the upload flow, check if it still works
```

The plugin:
- **Remembers every test** in YAML manifests that persist across sessions
- **Discovers your app's routes** by reading your source code — no manual setup
- **Runs all tests or just the relevant ones** based on what you describe in plain English
- **Tracks regressions** — tests that failed before run first, auto-removed after 3 passes
- **Reads every screenshot** and fails on visible errors — no silent pass on a broken page
- **Self-repairs** when the UI changes — detects renamed buttons, updates selectors
- **Generates missing tests** when you describe something that has no test yet

---

## In practice

### You set up your app once

```bash
/e2e-discover
```

The plugin reads your codebase (routes, navigation, components, feature flags, test fixtures, dev credentials) and generates a test for every page and interactive feature:

```
e2e-tests/
  _config.yaml                # base URL, credentials
  _regressions.yaml           # auto-maintained
  _shared/login.yaml          # reusable auth sequence
  auth/login.yaml
  dashboard/home.yaml
  dashboard/file-hub.yaml
  chat/upload-pdf.yaml
  chat/ask-question.yaml
  settings/profile.yaml
```

### Then you just talk to it

```bash
/e2e-run
```
Runs everything. Regressions first.

```bash
/e2e-run --regressions
```
Only the tests that failed last time. Fast feedback.

```bash
/e2e-run I refactored the sidebar, make sure the 11 modules still show up
```
Finds the sidebar tests, runs them, reports pass/fail with screenshots.

```bash
/e2e-run I added a legal watch widget in the chat panel
```
No test exists → reads the component → generates one → saves it → runs it.

```bash
/e2e-run I changed ArticleModal.tsx and notaire-chat-view.tsx
```
Checks `git diff`, maps changed files to impacted tests, runs them all.

---

## The 5 things agent-browser can't do alone

### 1. Persistent test catalog

agent-browser commands are ephemeral. This plugin stores every test as a YAML manifest. Your test suite grows over time. Next month you have 50 tests covering your whole app — and you wrote none of them by hand.

### 2. Regression tracking

When a test fails, it goes into `_regressions.yaml`. Next run, it executes first. After 3 consecutive passes, it's automatically removed. You always know what's broken and what's been fixed.

### 3. Self-repairing selectors

agent-browser uses refs (`e4`, `e16`) that change every time the DOM re-renders. This plugin uses **visible text** ("Submit", "Upload", "New conversation"). When a button is renamed, the plugin detects `STALE`, snapshots the page, finds the new label, updates the manifest, and re-runs.

### 4. Screenshot validation

With agent-browser alone, you take a screenshot and move on. Maybe you look at it, maybe you don't. This plugin **reads every screenshot with the AI** and fails immediately on any visible error — toasts, modals, blank screens, broken layouts. No silent passes.

### 5. Natural language interface

Instead of remembering which tests to run and what refs to use:

| Instead of | You say |
|-----------|---------|
| `agent-browser open ... && snapshot && click e4 && ...` | `/e2e-run check if login works` |
| Figuring out which tests cover your change | `/e2e-run I changed the payment form` |
| Writing a new test from scratch | `/e2e-run test the new export feature` (auto-generated) |
| Re-running last week's failures manually | `/e2e-run --regressions` |

---

## Test format

Tests are YAML — readable, editable, auto-generated:

```yaml
name: "Upload PDF and verify pipeline"
priority: high
requires_auth: true
timeout: 120s

data:
  pdf_file: "data-sample/contract.pdf"
  expected_entities: [seller, buyer, notary, price]

steps:
  - action: open
    url: "{base_url}/documents"

  - action: click
    target: "Upload"

  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"

  - action: llm-wait
    timeout: 90s
    checkpoints:
      - "OCR finished"
      - "Entities detected"
      - "Indexing complete"

  - action: llm-check
    criteria: "Entities include: {data.expected_entities}"
    severity: critical
    screenshot: entities.png
```

Selectors use **visible text** (`"Upload"`, `"file-input"`), not DOM refs that break on re-render.

### Available actions

| Action | What it does | Execution |
|--------|-------------|-----------|
| `open` | Navigate to URL | Direct |
| `click` | Click by visible text | Direct |
| `fill` | Type into input by placeholder/label | Direct |
| `press` | Keyboard key | Direct |
| `upload` | Upload a file | Direct |
| `select` | Pick dropdown option | Direct |
| `wait` | Fixed delay | Direct |
| `assert_url` | Check current URL | Direct |
| `assert_text` | Check text on page | Direct |
| `screenshot` | Capture + **mandatory AI validation** | Direct + AI |
| `include` | Reuse steps from another manifest | Direct |
| `llm-wait` | Poll until async conditions are met | AI polls every 3s |
| `llm-check` | AI evaluates page against criteria | AI |

---

## Installation

### 1. Prerequisites

```bash
npm install -g agent-browser
agent-browser install --with-deps
```

### 2. Install the plugin

```bash
/plugin marketplace add bacoco/e2e-agent-browser
/plugin install e2e-agent-browser@e2e-agent-browser
```

`/e2e-discover` and `/e2e-run` are ready.

### Manual alternative

```bash
git clone https://github.com/bacoco/e2e-agent-browser.git
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-discover ~/.claude/skills/
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-run ~/.claude/skills/
```

---

## Supported frameworks

Next.js, React, Vue, Angular, and any web framework with detectable routes. The discover skill adapts — if auto-detection fails, it asks.

## License

MIT
