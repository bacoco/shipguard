# e2e-agent-browser

**Stop writing E2E tests. Just tell the AI what to check.**

A Claude Code plugin that turns natural language into automated browser tests. Describe what you changed or what to verify — the plugin finds the right tests, creates missing ones, runs them, and tracks regressions. All through [agent-browser](https://github.com/nicobailey/agent-browser) (Playwright).

```bash
/e2e-run I just changed the upload flow, make sure it still works
```

---

## The Problem

You just pushed a change. Now you need to verify it works. Today that means:

- Manually clicking through the app
- Forgetting to test edge cases you broke 2 weeks ago
- Writing Playwright scripts that break every time a button moves
- Or asking the AI to "test the app" and watching it take random screenshots without catching obvious errors

**None of this scales. None of this remembers. None of this is reliable.**

---

## The Solution

Tell the plugin what you did. It handles the rest.

### "I changed the login page"

```bash
/e2e-run I modified the login page
```

The plugin:
1. Checks `git diff` to see what files changed
2. Finds existing login tests → runs them
3. Detects the submit button was renamed → updates the test automatically
4. Takes a screenshot → reads it → confirms no errors visible
5. Reports: **PASS**

### "Does the file upload still work?"

```bash
/e2e-run does the file upload still work?
```

The plugin:
1. Finds the upload test manifest
2. Opens the app, logs in, navigates to upload
3. Uploads a real PDF from your test fixtures
4. Waits for the processing pipeline to complete (polling every 3s)
5. Verifies entities were extracted, indexing finished
6. Asks a question about the document → checks the answer is grounded in the PDF
7. Reports: **PASS** — or **FAIL** with the exact screenshot showing what went wrong

### "I added a new sidebar widget"

```bash
/e2e-run I added a legal watch widget to the chat sidebar
```

The plugin:
1. Searches existing tests → nothing covers this widget
2. Reads the component code to understand what it does
3. **Generates a new test** with real steps: click the toggle, verify 3 tabs appear, verify data loads
4. Saves it to `e2e-tests/chat/legal-watch.yaml`
5. Executes it immediately
6. Reports: **PASS** — new test added to the suite

### "Run everything, I'm about to deploy"

```bash
/e2e-run
```

The plugin:
1. Runs **regressions first** (tests that failed recently)
2. Then all tests by priority
3. Every screenshot is read and validated — errors are never ignored
4. Generates a full report with pass/fail, screenshots, timing

### "Just check the regressions"

```bash
/e2e-run --regressions
```

Quick feedback loop: only re-runs tests that previously failed. After 3 consecutive passes, they're automatically removed from the regression list.

---

## How It Works

### Two skills, one workflow

| Skill | When to use | What it does |
|-------|------------|--------------|
| `/e2e-discover` | Once at setup, then after major UI changes | Explores your codebase, finds every route/page/form, generates a test tree mirroring your navigation |
| `/e2e-run` | Every time you change code | Understands what you describe, finds/creates/updates tests, executes them, tracks regressions |

### Hybrid execution

Not everything needs AI judgment. Clicking a button is mechanical. Checking if the right entities were extracted from a legal document requires intelligence.

| Step | Execution | Why |
|------|-----------|-----|
| Login, navigate, click, fill forms | **Direct** (agent-browser CLI) | Fast, deterministic |
| Wait for async pipeline to finish | **Hybrid** (LLM polls every 3s) | Needs to interpret progress indicators |
| "Is this response relevant to the uploaded PDF?" | **LLM evaluation** | Requires understanding content |
| Every screenshot | **LLM reads the image** | Catches errors humans would see but scripts miss |

### Dynamic test management

Tests are living artifacts. They evolve with your code.

| What happens | What the plugin does |
|-------------|---------------------|
| You describe a feature with no test | **Creates** a new manifest with real steps |
| A test breaks because a button was renamed | **Updates** the selectors and re-runs |
| A feature is removed | **Marks the test deprecated**, skips it |
| A regression passes 3 times in a row | **Removes it** from the regression list |

### Mandatory screenshot validation

Every screenshot taken during a test is **read by the AI and visually inspected**. This is not optional.

- Error messages → **FAIL**
- Blank screens → **FAIL**
- Loading spinners that should have resolved → **FAIL**
- "Partial pass" → **does not exist**

If it looks wrong in the screenshot, the test fails. Period.

---

## Real-World Examples

### E-commerce app

```bash
/e2e-run verify the checkout flow after I changed the payment form
```

→ Logs in, adds item to cart, fills payment form, submits, verifies order confirmation page, checks no console errors.

### SaaS dashboard

```bash
/e2e-run I refactored the analytics charts, make sure they render
```

→ Navigates to analytics page, waits for charts to load, verifies data is displayed (not empty state), screenshots each chart type.

### Document processing platform

```bash
/e2e-run upload a PDF and verify the pipeline extracts the right entities
```

→ Uploads a real document, waits for OCR → entity extraction → indexing, verifies entities match the document type, asks a question, checks the answer cites the document.

### Mobile-responsive app

```bash
/e2e-run check if the navigation works on mobile viewport
```

→ Sets viewport to 375x812, opens the app, verifies hamburger menu appears, opens it, clicks through main sections, screenshots each.

---

## Test Manifest Format

Tests are YAML files — human-readable, editable, auto-generated:

```yaml
name: "Upload PDF and verify pipeline"
priority: high
requires_auth: true
timeout: 120s
tags: [pipeline, upload]

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
    description: "Pipeline completes"
    timeout: 90s
    checkpoints:
      - "OCR finished"
      - "Entities detected"
      - "Indexing complete"

  - action: llm-check
    description: "Correct entities extracted"
    criteria: "Entities include: {data.expected_entities}"
    severity: critical
    screenshot: entities.png

  - action: fill
    target: "Ask a question"
    value: "What is the sale price?"

  - action: press
    key: Enter

  - action: wait
    duration: 15s

  - action: llm-check
    description: "Answer is grounded in the document"
    criteria: "Cites specific info from the PDF, not generic"
    severity: critical
    screenshot: answer.png
```

### Available Actions

| Action | What it does |
|--------|-------------|
| `open` | Navigate to a URL |
| `click` | Click an element by its visible text |
| `fill` | Type into an input by its placeholder or label |
| `press` | Press a keyboard key |
| `upload` | Upload a file |
| `select` | Pick a dropdown option |
| `wait` | Wait a fixed duration |
| `assert_url` | Verify the current URL |
| `assert_text` | Verify text exists on the page |
| `screenshot` | Capture + mandatory visual validation |
| `include` | Reuse steps from another manifest |
| `llm-wait` | Wait for async conditions (LLM polls and checks) |
| `llm-check` | AI evaluates the page against your criteria |

Selectors use **visible text**, not CSS selectors or DOM refs. "Click the Submit button" works even if the button's class name changes.

---

## Installation

### 1. Install agent-browser

```bash
npm install -g agent-browser
agent-browser install --with-deps
```

### 2. Install the plugin

```bash
/plugin marketplace add bacoco/e2e-agent-browser
/plugin install e2e-agent-browser@e2e-agent-browser
```

Done. `/e2e-discover` and `/e2e-run` are ready.

### Alternative: manual install

```bash
git clone https://github.com/bacoco/e2e-agent-browser.git
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-discover ~/.claude/skills/
cp -r e2e-agent-browser/plugins/e2e-agent-browser/skills/e2e-run ~/.claude/skills/
```

---

## Works With Any Web Framework

| Framework | Route detection | Tested |
|-----------|----------------|--------|
| Next.js (App Router) | `app/` directory | Yes |
| Next.js (Pages) | `pages/` directory | Yes |
| React + React Router | Router config | Yes |
| Vue + Vue Router | `router/index.ts` | Yes |
| Angular | Routing modules | Yes |
| Any other | Grep-based heuristics | Yes |

---

## Report

After each run:

```
E2E run complete: 11/12 passed, 1 failed
Report: e2e-tests/_results/report.md

Failures:
- harmonia/modules.yaml: 10 modules instead of 11 (Reunion missing)
  Screenshot: _results/screenshots/harmonia-modules-fail.png

New tests generated:
- chat/legal-watch.yaml
```

---

## License

MIT
