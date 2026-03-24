# e2e-agent-browser

Automated E2E testing skills for [Claude Code](https://claude.ai/code) using [agent-browser](https://github.com/nicobailey/agent-browser) (Playwright CLI).

Two skills that discover testable user journeys from your codebase and execute them with hybrid scripted + LLM assertions.

## Why

- **Repeatable** — Same test paths every time, not improvised by the LLM
- **Regression-aware** — Tests that failed before run first; removed after 3 consecutive passes
- **Intelligent** — Scripted for mechanical steps, LLM for qualitative checks ("are the right entities displayed?")
- **Adaptive** — Detects when UI changes break selectors, suggests updates
- **Generic** — Works on any web project (Next.js, React, Vue, Angular, etc.)

## Installation

### Prerequisites

```bash
# Install agent-browser
npm install -g agent-browser
agent-browser install --with-deps

# Verify
agent-browser --version
```

### Install Skills

Copy the skills into your Claude Code skills directory:

```bash
# Option 1: Clone and symlink
git clone https://github.com/anthropics/e2e-agent-browser.git
ln -s $(pwd)/e2e-agent-browser/skills/e2e-discover ~/.claude/skills/e2e-discover
ln -s $(pwd)/e2e-agent-browser/skills/e2e-run ~/.claude/skills/e2e-run

# Option 2: Copy directly
cp -r e2e-agent-browser/skills/e2e-discover ~/.claude/skills/
cp -r e2e-agent-browser/skills/e2e-run ~/.claude/skills/
```

## Quick Start

```bash
# 1. In your project, discover routes and generate test manifests
/e2e-discover

# 2. Customize the generated manifests (optional but recommended)
#    Edit e2e-tests/ YAML files to add real test data and assertions

# 3. Run all tests
/e2e-run

# 4. Run only regressions (fast feedback)
/e2e-run --regressions

# 5. Run a specific test
/e2e-run notaire-chat/upload-pdf
```

## How It Works

### `/e2e-discover`

Explores your codebase to find:
- Frontend framework and route definitions
- Navigation structure (sidebar, menus, dashboard)
- Feature flags (enabled/disabled features)
- Interactive components (forms, uploads, chat, modals)
- Test data (fixtures, sample files)
- Dev credentials

Generates a `e2e-tests/` directory mirroring your UI navigation:

```
e2e-tests/
  _config.yaml              # base URL, credentials
  _regressions.yaml         # auto-maintained failure tracking
  _shared/
    login.yaml              # reusable login sequence
  auth/
    login.yaml
  dashboard/
    home.yaml
    file-hub.yaml
  chat/
    send-message.yaml
    upload-document.yaml
```

**Rules:**
- Never overwrites existing manifests
- Never deletes manifests (marks `deprecated: true`)
- Pre-fills test data when fixtures are found

### `/e2e-run`

Executes the YAML manifests with hybrid intelligence:

| Step Type | Execution | Example |
|-----------|-----------|---------|
| `open`, `click`, `fill`, `press` | Mechanical (agent-browser) | Navigate, interact |
| `upload`, `select` | Mechanical | File upload, dropdowns |
| `assert_url`, `assert_text` | Mechanical | Simple checks |
| `llm-wait` | Hybrid (LLM polls) | Wait for async pipeline |
| `llm-check` | LLM evaluation | "Are the right entities displayed?" |

**Selector resolution:** Uses visible text, placeholder, and aria-labels — never DOM refs (which break on re-render).

**Regression tracking:**
- Failed tests are added to `_regressions.yaml`
- Regression tests run first on every `/e2e-run`
- Removed after 3 consecutive passes

## Manifest Format

```yaml
name: "Upload PDF and verify pipeline"
description: "Upload a notarial deed, verify OCR + entity extraction + indexing"
priority: high                    # high | medium | low
requires_auth: true               # auto-includes _shared/login.yaml
timeout: 120s
tags: [pipeline, upload]

data:
  pdf_file: "data-sample/deed.pdf"
  expected_entities: [seller, buyer, notary, price]

steps:
  - action: open
    url: "{base_url}/chat"

  - action: click
    target: "New conversation"

  - action: upload
    target: "file-input"
    file: "{data.pdf_file}"

  - action: llm-wait
    description: "Wait for processing pipeline to complete"
    timeout: 90s
    checkpoints:
      - "OCR completed"
      - "Entities detected (count > 0)"
      - "Indexing finished"
    screenshot: pipeline-done.png

  - action: llm-check
    description: "Verify extracted entities match document type"
    criteria: "Entities include: {data.expected_entities}"
    severity: critical

  - action: fill
    target: "Ask a question"
    value: "What is the sale price and who are the parties?"

  - action: press
    key: Enter

  - action: wait
    duration: 15s

  - action: llm-check
    description: "Response is relevant to the uploaded document"
    criteria: "Answer cites specific information from the PDF, not generic"
    severity: critical
    screenshot: chat-response.png
```

### Actions Reference

| Action | Fields | Description |
|--------|--------|-------------|
| `open` | `url` | Navigate to URL |
| `click` | `target` | Click element by visible text |
| `fill` | `target`, `value` | Fill input by placeholder/label |
| `press` | `key` | Press keyboard key |
| `upload` | `target`, `file` | Upload file to input |
| `select` | `target`, `option` | Select dropdown option |
| `wait` | `duration` | Sleep (e.g., "5s", "15s") |
| `assert_url` | `expected` | Check current URL |
| `assert_text` | `expected` | Check text exists on page |
| `screenshot` | `filename` | Capture screenshot |
| `include` | `file` | Inline steps from another manifest |
| `llm-wait` | `description`, `timeout`, `checkpoints`, `screenshot?` | Poll until conditions met |
| `llm-check` | `description`, `criteria`, `severity`, `screenshot?` | LLM evaluates page state |

### Variables

- `{base_url}` — from `_config.yaml`
- `{credentials.username}`, `{credentials.password}` — from `_config.yaml`
- `{data.xxx}` — from manifest `data:` section

## Report

After each run, a report is generated at `e2e-tests/_results/report.md`:

```
E2E Report — 2026-03-24 10:30

Tests: 12 run, 10 pass, 1 fail, 1 stale
Duration: 4m 32s

Failures:
  harmonia/modules.yaml — 10 modules instead of 11

Stale (UI changed):
  dashboard/erp.yaml — "Generate" button not found
```

## License

MIT
