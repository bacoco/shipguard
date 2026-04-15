# Report formats reference

Templates for `_regressions.yaml`, `report.md`, and final user summary.

---

## `_regressions.yaml` format

```yaml
# Auto-maintained by /sg-visual-run — do not edit manually
regressions:
  - test: dashboard/file-upload
    first_failed: "2026-03-22"
    last_failed: "2026-03-24"
    consecutive_passes: 0
    failure_reason: "Pipeline timeout after 90s"
    screenshot: "_results/screenshots/upload-pdf-fail.png"
```

### Add / update failures

For each test that FAILED, STALE, or ERROR:
- If already in regressions: update `last_failed`, `failure_reason`, reset `consecutive_passes: 0`
- If new failure: add entry with `first_failed: today`, `consecutive_passes: 0`
- STALE entries use `failure_reason: "Element not found: {target}"`
- ERROR entries use `failure_reason: "Browser crash / agent-browser error"`

### Track passes

For each test that PASSED and is in regressions:
- Increment `consecutive_passes`
- If `consecutive_passes >= 3` → **remove from regressions** (resolved)

---

## `report.md` template

Write to `{report_path}` (default: `visual-tests/_results/report.md`):

```markdown
# Visual Report — {date} {time}

> **Note:** These tests verify visual page loading and surface UI interactions.
> They do not replace unit tests, integration tests, or deterministic visual tests (pytest, Playwright).
> llm-check assertions are evaluated by the LLM with no external observer.

## Summary
- Tests: {total} run, {pass} pass, {fail} fail, {stale} stale, {error} error, {skip} skip
- Duration: {total_time}
- Regressions fixed: {count} (removed after 3 consecutive passes)
- New failures: {count}
- Generated tests: {count} (new manifests created during this run)

## Failures
### {test_path} — FAIL
- Step {n}: {action} "{description}"
- Expected: {criteria}
- Actual: {llm_explanation}
- Screenshot: {screenshot_path}

## Stale Tests
### {test_path} — STALE
- Step {n}: {action} target "{target}" — element not found
- Action: Run `/sg-visual-discover` to update selectors

## Generated Tests
- {test_path}: created to cover "{user_description}"

## Regressions Status
| Test | First failed | Last failed | Consecutive passes | Status |
|------|-------------|-------------|-------------------|--------|

## All Results
| Test | Status | Duration | Steps |
|------|--------|----------|-------|
```

---

## User summary (console output)

After the report is written, display to the user:

```
Visual run complete: {pass}/{total} passed, {fail} failed, {stale} stale
Report: visual-tests/_results/report.md
Screenshots: visual-tests/_results/screenshots/

{if failures}
Failures:
- {test_path}: {one-line reason}
{/if}

{if stale}
Stale tests (UI changed — run /sg-visual-discover):
- {test_path}
{/if}

{if generated}
New tests generated:
- {test_path}
{/if}
```
