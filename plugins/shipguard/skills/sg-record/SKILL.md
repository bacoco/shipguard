---
name: sg-record
description: Record browser interactions as replayable ShipGuard test manifests. Opens a Playwright browser with a floating toolbar — user navigates, clicks Check to mark assertions, clicks Stop to generate YAML. Trigger on "sg-record", "record test", "record interactions", "macro recorder", "enregistrer test", "enregistre les interactions".
context: conversation
argument-hint: "<url> [--name <name>] [--storage <auth.json>] [--save-storage <path>]"
---

# /sg-record — Macro Recorder

Record your browser interactions and convert them into replayable ShipGuard YAML test manifests. Like Excel's macro recorder, but for visual testing.

## Pipeline Position

```
sg-visual-discover (auto) ──┐
                             ├──► manifests/ ──► sg-visual-run ──► sg-visual-review ──► sg-visual-fix
sg-record (human)         ───┘
```

`sg-discover` scans code to auto-generate tests. `sg-record` captures what a **human** does manually. Both produce the same YAML format — zero changes to the rest of the pipeline.

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-record http://localhost:6969` | Open recorder on the given URL |
| `/sg-record http://localhost:6969 --name login-flow` | Record with a preset manifest name |
| `/sg-record http://localhost:6969 --storage auth.json` | Skip login by loading saved auth state |
| `/sg-record --save-storage auth.json` | Save auth state after recording (for reuse) |

## How It Works

### 1. Launch

Run the recorder script:

```bash
node visual-tests/sg-record.mjs <url> [--name <name>] [--storage <auth.json>]
```

This opens a **Playwright Chromium** browser targeting the URL with a floating recording toolbar injected in the bottom-right corner.

### 2. Record

The user navigates the app normally. Every interaction is captured automatically:

| User action | Recorded as |
|-------------|-------------|
| Click a button/link | `action: click, target: "Button text"` |
| Fill an input field | `action: fill, target: "Field label", value: "typed text"` |
| Select a dropdown option | `action: select, target: "Label", value: "Option"` |
| Upload a file | `action: upload, file: "filename.pdf"` |
| Navigate to a new page | `action: open, url: "/new-page"` |

### 3. Toolbar Controls

The floating toolbar shows recorded steps in real-time:

| Control | What it does |
|---------|-------------|
| **Step list** | See every recorded action, scrollable |
| **Undo** | Remove the last step (repeatable) |
| **Delete (x)** | Remove a specific step without affecting others |
| **Pause / Resume** | Stop recording temporarily (navigate freely without capturing) |
| **Check** | Mark an element as an assertion (see below) |
| **Stop** | End recording, save manifest |
| **Minimize** | Collapse toolbar to a compact bar |

### 4. Check Mode (Assertions)

Click **Check** to enter assertion mode:
1. Toolbar border turns amber
2. Hover over elements to see what will be captured (amber highlight)
3. Click on the element you want to verify
4. The recorder captures its text content as an `assert_text` step
5. If the text is long (>80 chars), it becomes an `llm-check` instead (AI judges the assertion at replay time)
6. A screenshot is auto-captured at each check point
7. Check mode deactivates after one capture

### 5. Stop and Save

Click **Stop** in the toolbar:
1. If no `--name` was given, the recorder asks for a manifest name
2. Actions are converted to ShipGuard YAML format
3. Manifest saved to `visual-tests/manifests/recorded-<name>.yaml`
4. Terminal shows the command to replay: `sg-visual-run --manifests manifests/recorded-<name>.yaml`

## Output Format

The recorder produces standard ShipGuard YAML manifests:

```yaml
name: "login-flow"
description: "Recorded session — login-flow"
priority: medium
requires_auth: false
timeout: 60s
tags: [recorded]
source: recorded
recorded_at: "2026-04-11T14:30:00Z"

steps:
  - action: open
    url: "{base_url}/login"

  - action: fill
    target: "Nom d'utilisateur"
    value: "vlad"

  - action: fill
    target: "Mot de passe"
    value: "loic"

  - action: click
    target: "Se connecter"

  - action: assert_text
    text: "Tableau de bord"
    screenshot: "login-flow-check-1.png"

  - action: screenshot
    path: "login-flow-check-1.png"
```

The `source: recorded` field distinguishes recorded manifests from auto-generated ones (`source: discovered`).

## Test Library in Review Page

Recorded manifests appear as cards in a dedicated **"Recorded Tests"** tab in the review page (`/sg-visual-review`):

- Each card shows: name, step summary, step count, check count, recording date
- Select one or multiple cards
- Click **"Run N tests"** to get the CLI command for `sg-visual-run`
- Results appear in the existing Visual Tests tab after execution

## Authentication

Playwright opens a fresh Chromium — the user is not logged in by default.

- **Without `--storage`**: Login manually during recording. Login steps become part of the manifest.
- **With `--storage auth.json`**: Load saved cookies/localStorage to skip login.
- **First time**: Use `--save-storage auth.json` to capture auth state after logging in. Reuse with `--storage auth.json` on subsequent recordings.

## Pre-flight Checks

Before recording, verify:

1. **Target URL is reachable**: `curl -s -o /dev/null -w "%{http_code}" <url>` returns 200
2. **Playwright is installed**: `npx playwright --version` succeeds. If not: `npx playwright install chromium`
3. **Manifests directory exists**: `visual-tests/manifests/` (created automatically)
4. **Config exists**: `visual-tests/_config.yaml` for `base_url` (optional — falls back to the URL argument)

## File Structure

```
visual-tests/
  sg-record.mjs              # CLI entry point
  lib/
    recorder-toolbar.js       # Injected toolbar (client-side)
    recorder-toolbar.css      # Toolbar styles
    actions-to-yaml.mjs       # Conversion: actions → YAML
    actions-to-yaml.test.mjs  # Unit tests (11 tests)
    integration-test.mjs      # Pipeline smoke test
  manifests/
    recorded-*.yaml           # Output from recordings
```

## Execution Steps for the Skill

When the user invokes `/sg-record`:

1. Parse the URL argument. If missing, ask with AskUserQuestion: "What URL do you want to record on?"
2. Run pre-flight checks (URL reachable, Playwright installed)
3. Execute: `node visual-tests/sg-record.mjs <url> <flags>`
4. Tell the user: "Browser is open. Navigate, click Check to mark verifications, click Stop when done."
5. Wait for the process to complete (the user clicks Stop in the browser)
6. Report: manifest path, step count, and the command to replay
7. Offer: "Want to run these tests now with `/sg-visual-run`?"
