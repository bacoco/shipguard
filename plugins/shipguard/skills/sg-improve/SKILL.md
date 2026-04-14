---
name: sg-improve
description: Auto-improve ShipGuard skills from real session learnings. Analyzes the current conversation for friction points, extracts insights, saves project-specific learnings locally, and files generic improvements as GitHub issues. Trigger on "sg-improve", "improve shipguard", "ameliore shipguard", "shipguard feedback", "session insights".
context: conversation
argument-hint: "[--local-only] [--github-only] [--dry-run]"
---

# /sg-improve — Self-Improving Feedback Loop

Analyze the current session for what worked, what broke, and what was slow. Extract actionable insights, save them locally for future runs, and file generic improvements as GitHub issues on the ShipGuard repo.

## How It Works

```
Session complete (audit, visual-run, etc.)
  │
  ▼
/sg-improve
  │
  ├─► Phase 1: Extract — scan conversation for friction signals
  ├─► Phase 2: Classify — project-specific vs generic
  ├─► Phase 3: Local — write .shipguard/learnings.yaml (project memory)
  ├─► Phase 4: GitHub — create issue on bacoco/ShipGuard (generic only)
  └─► Phase 5: Inject — update sg-code-audit prompt hints for next run
```

## Invocations

| Command | Behavior |
|---------|----------|
| `/sg-improve` | Full loop — local + GitHub issue |
| `/sg-improve --local-only` | Save learnings locally, no GitHub issue |
| `/sg-improve --github-only` | File GitHub issue only, no local save |
| `/sg-improve --dry-run` | Show what would be filed, don't write anything |

---

## Phase 1 — Extract Friction Signals

Scan the conversation history for these signal patterns:

### Error Signals
- **Context overflow**: "Prompt is too long" → zone sizing issue
- **API overload**: "529", "overloaded_error" → retry/backoff issue
- **Syntax errors post-merge**: "IndentationError", "SyntaxError", "TypeError" after worktree merge → validation gap
- **Browser collision**: agent-browser returning wrong URL or "Target page closed" → parallel execution bug
- **Session expiry**: redirect to `/` or `/login` mid-test → auth persistence issue
- **Docker/infra failure**: "unhealthy", "dependency failed" → rebuild/startup issue

### Performance Signals
- **Re-splits**: count of zones that overflowed and were re-split
- **Retry count**: total 529/overload retries across all agents
- **Total wall-clock time**: from first dispatch to final aggregation
- **Agent utilization**: how many agents completed vs failed vs retried

### Quality Signals
- **Noise ratio**: count of `low` severity bugs / total bugs (high ratio = noisy)
- **Duplicate bugs**: bugs found by multiple agents on the same file
- **False positives**: bugs that were "deferred" or marked not-a-bug
- **Post-audit regressions**: any Docker startup failure or visual test failure after audit fixes

### What-Worked Signals
- **Clean merges**: zones that merged without conflict
- **High-value finds**: critical/high bugs that were real and impactful
- **Verified fixes**: bugs confirmed by visual testing

For each signal found, record:
```yaml
- signal: "context_overflow"
  count: 3
  details: "z01 (172 files), z02 (178 files), z04 (214 files)"
  impact: "Added 10 min latency from re-splits"
```

---

## Phase 2 — Classify

For each extracted signal, classify as:

| Type | Criteria | Destination |
|------|----------|-------------|
| **project-specific** | References specific file paths, services, ports, timing | `.shipguard/learnings.yaml` |
| **generic** | Applies to any repo using ShipGuard | GitHub issue on bacoco/ShipGuard |
| **both** | Generic pattern observed in project-specific context | Both destinations |

Examples:
- "z01 (hooks, 172 files) overflowed" → **project-specific** (knows about hooks dir)
- "Zones >150 files overflow Sonnet context" → **generic** (applies to everyone)
- "api-synthesia takes 4 min to start after rebuild" → **project-specific**
- "Post-merge syntax validation is missing" → **generic**

---

## Phase 3 — Local Learnings

Write to `{repo_root}/.shipguard/learnings.yaml`. Create the directory if it doesn't exist.

### Schema

```yaml
# .shipguard/learnings.yaml — Auto-maintained by /sg-improve
# These learnings are injected into sg-code-audit agent prompts for this repo.
version: 1
last_updated: "2026-04-14T07:00:00Z"

zone_hints:
  # Directories that need smaller zones (overflow history)
  - path: "apps/uranus/src/hooks/"
    max_files: 80
    reason: "172 files caused Sonnet context overflow on 2026-04-13"
  - path: "apps/uranus/src/components/notaire-chat/"
    max_files: 60
    reason: "Complex TSX components, high token density"

infra_hints:
  # Timing and dependency knowledge
  - service: "api-synthesia"
    startup_time_seconds: 240
    note: "Wait for (healthy) before starting uranus"
  - service: "uranus"
    build_type: "COPY"
    note: "Requires docker rebuild to pick up new public/ files"

audit_hints:
  # Patterns to watch for in this specific codebase
  - pattern: "Zustand selector || []"
    severity: high
    note: "Causes infinite re-renders — project-specific CLAUDE.md rule"
  - pattern: ".first() without None guard"
    severity: critical
    note: "5 instances found in rag_tasks.py/video_rag_tasks.py on 2026-04-13"

noise_filters:
  # Low-value patterns to deprioritize
  - pattern: "f-string in logger"
    action: "batch"
    reason: "13% of all findings, low severity, batch into single entry"

session_history:
  - date: "2026-04-14"
    mode: "standard"
    files: 2574
    zones: 13
    bugs: 79
    fixed: 77
    critical: 9
    wall_clock_minutes: 90
    overflows: 3
    retries: 7
    post_merge_failures: 1
```

### Update Rules

- If `learnings.yaml` exists, READ it first and UPDATE (don't overwrite)
- `zone_hints`: add new entries, update `max_files` if overflow happened again on a known path
- `session_history`: append new entry (keep last 10)
- `noise_filters`: add patterns that generated >5 low-severity findings
- Never remove entries — let them accumulate. The user can prune manually.

---

## Phase 4 — GitHub Issue

Create an issue on `bacoco/ShipGuard` using `gh issue create`.

### Issue Format

```markdown
## Session Insights — {repo_name} ({date})

**Audit:** {mode} mode, {files} files, {zones} zones, {bugs} bugs found
**Wall clock:** {minutes} min | Overflows: {overflow_count} | Retries: {retry_count}

### Improvements Found

{For each generic insight:}

#### {N}. {Title}

**Problem:** {What happened}
**Impact:** {Time wasted, bugs missed, user friction}
**Proposal:** {Concrete change to the skill prompt or code}
**Affected skill:** sg-code-audit | sg-visual-run | sg-visual-review

---

### What Worked Well

{List of things that performed as expected — useful for knowing what NOT to change}

### Severity Table

| # | Issue | Severity | Effort | Skill |
|---|-------|----------|--------|-------|
```

### Labels

Add labels based on content:
- `improvement` — always
- `code-audit` — if insights relate to `/sg-code-audit`
- `visual-run` — if insights relate to `/sg-visual-run`
- `dx` — if it's about developer experience (UX of the skill)
- `bug` — if a skill instruction produced incorrect behavior

### Deduplication

Before creating the issue:
1. `gh issue list --repo bacoco/ShipGuard --state open --label improvement --limit 20`
2. Check if any open issue has a similar title or covers the same friction points
3. If >50% overlap: comment on the existing issue instead of creating a new one
4. If <50% overlap: create new issue

---

## Phase 5 — Inject Into Next Run

The learnings in `.shipguard/learnings.yaml` should influence the next `/sg-code-audit` run. This phase doesn't modify the skill prompt directly — instead, it generates a **context block** that the audit skill reads at startup.

### How sg-code-audit Uses Learnings

Add this to Phase 3 (Discover Zones) of `sg-code-audit`:

```
If .shipguard/learnings.yaml exists:
  1. Read zone_hints — apply max_files constraints during zone splitting
  2. Read noise_filters — inject "batch these patterns" instruction into agent prompts
  3. Read audit_hints — add project-specific patterns to the checklist
  4. Log: "Loaded {N} learnings from .shipguard/learnings.yaml"
```

This creates the feedback loop:
```
Run 1: zones overflow → /sg-improve saves zone_hints
Run 2: sg-code-audit reads zone_hints → smaller zones → no overflow
Run 2: new pattern found → /sg-improve adds audit_hint
Run 3: sg-code-audit includes new pattern → catches it earlier
```

---

## Output

After completion, display:

```
/sg-improve complete:
  Local: .shipguard/learnings.yaml updated ({N} zone hints, {M} audit hints)
  GitHub: bacoco/ShipGuard#{issue_number} — "{title}"
  
  Next sg-code-audit run will use:
  - {N} zone size constraints
  - {M} noise filters
  - {K} project-specific patterns
```

---

## Final Checklist

- [ ] Conversation scanned for all signal types (error, performance, quality, success)
- [ ] Signals classified as project-specific vs generic
- [ ] `.shipguard/learnings.yaml` created or updated (if not `--github-only`)
- [ ] GitHub issue created or existing issue commented (if not `--local-only`)
- [ ] Issue deduplicated against open issues
- [ ] Summary displayed to user
