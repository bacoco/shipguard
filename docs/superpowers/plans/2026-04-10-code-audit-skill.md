# ShipGuard `/code-audit` Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/code-audit` skill to ShipGuard that dispatches parallel AI agents to audit a codebase, fix bugs, and produce structured JSON results viewable in the visual-review dashboard.

**Architecture:** Single SKILL.md orchestrates the full flow: detect stack → discover zones → dispatch agents in worktrees → collect JSON → merge → aggregate → report. The visual-review page gains a "Code Audit" tab by reading `audit-results.json`. A handoff field `impacted_routes` feeds into `/visual-run --from-audit`.

**Tech Stack:** Claude Code skills (SKILL.md), Agent tool with worktree isolation, Node.js build script (build-review.mjs), HTML/CSS/JS (review template)

**Spec:** `docs/specs/2026-04-10-code-audit-design.md`

---

## File Structure

```
plugins/agentic-visual-debugger/skills/
  code-audit/
    SKILL.md                    ← NEW: main skill (orchestration logic)
    references/
      checklists.md             ← NEW: language-specific bug checklists
  visual-review/
    _review-template.html       ← MODIFY: add Code Audit tab
    build-review.mjs            ← MODIFY: read audit-results.json
  visual-run/
    SKILL.md                    ← MODIFY: add --from-audit flag
```

---

### Task 1: Create the code-audit SKILL.md

**Files:**
- Create: `plugins/agentic-visual-debugger/skills/code-audit/SKILL.md`

- [ ] **Step 1: Create the skill frontmatter + overview**

```markdown
---
name: code-audit
description: Parallel AI codebase audit — dispatches agents to find and fix bugs across the entire repo. Produces structured JSON results viewable in /visual-review. Trigger on "code audit", "audit codebase", "find bugs", "code-audit", "audit code", "static audit", "security audit", "ship guard".
context: conversation
argument-hint: "[quick|standard|deep|paranoid] [--focus=path] [--report-only]"
---

# /code-audit — Parallel Codebase Audit

Dispatch parallel AI agents to audit every file in your repo. Each agent reviews a non-overlapping zone, finds bugs, fixes them, and produces structured JSON. Results appear in the `/visual-review` dashboard under a "Code Audit" tab.
```

- [ ] **Step 2: Write the invocation section**

Document all modes and flags:
- `/code-audit` → standard (10 agents, 1 round)
- `/code-audit quick` → 5 agents, surface
- `/code-audit deep` → 15 agents, 2 rounds
- `/code-audit paranoid` → 20 agents, 3 rounds
- `--focus=path/` → restrict scope
- `--report-only` → no fixes

- [ ] **Step 3: Write Phase 1 — Parse Arguments**

Parse the first positional arg as mode (quick/standard/deep/paranoid, default standard). Parse `--focus=` and `--report-only` flags. Set agent count and round count from mode:

```markdown
| Mode | Agents | Rounds |
|------|--------|--------|
| quick | 5 | 1 |
| standard | 10 | 1 |
| deep | 15 | 2 |
| paranoid | 20 | 3 |
```

- [ ] **Step 4: Write Phase 2 — Detect Stack**

Scan repo root. For each detection rule, check file existence with Glob:

```markdown
1. Glob `**/*.py` — if matches > 0 AND (Glob `**/requirements.txt` OR `**/pyproject.toml`): activate Python checklist
2. Glob `**/*.ts` OR `**/*.tsx` — if matches > 0 AND Glob `**/package.json`: activate TypeScript checklist
3. Glob `**/Dockerfile*` OR `**/docker-compose*`: activate Infra checklist
4. Glob `**/next.config.*`: activate Next.js checklist
5. Glob `**/*.go`: activate Go checklist
6. Glob `**/*.rs`: activate Rust checklist
7. Glob `**/*.java` OR `**/*.kt`: activate JVM checklist
8. Read CLAUDE.md if it exists at repo root — store contents for injection
```

- [ ] **Step 5: Write Phase 3 — Discover Zones**

Document the zone splitting algorithm:

```markdown
1. Use Bash: `find . -name '*.py' -o -name '*.ts' -o -name '*.tsx' -o -name '*.go' -o -name '*.rs' -o -name '*.java' -o -name '*.kt' | sed 's|/[^/]*$||' | sort -u | uniq -c | sort -rn`
   This gives directory → file count.

2. Apply splitting rules:
   - dir with <= 30 files → 1 zone
   - dir with 31-80 files → split by subdirectories (re-run count on children)
   - dir with 80+ files → split by sub-subdirectories
   - Infra files (Dockerfile*, docker-compose*, *.yml in root or infra/) → 1 dedicated zone

3. Merge zones with < 5 files into their nearest neighbor

4. If zone count > agent count: merge smallest zones until count matches
   If zone count < agent count: split largest zones until count matches

5. Store final zones as an array: [{id: "z01", paths: ["src/routes/", "src/middleware/"], file_count: 28}, ...]
```

- [ ] **Step 6: Write Phase 4 — Build Prompts + Dispatch Agents**

Document the agent prompt template:

```markdown
For each zone, build a prompt:

"""
You are auditing a codebase. Your scope is ONLY: {zone.paths joined by AND}.

{IF CLAUDE.md exists}
Project rules (from CLAUDE.md):
{CLAUDE.md content, truncated to 3000 chars}
{END IF}

**Round {N} focus — {round_description}:**
{Round-specific checklist from references/checklists.md}

**Language-specific checks ({detected_languages}):**
{Activated checklists from references/checklists.md}

**Output format:**
Write your findings to a JSON file. The JSON must follow this exact schema:
{zone JSON schema from spec}

{IF fix mode}
Fix every bug you find using Edit. Commit all fixes with message: "audit-r{round}({zone_slug}): fix N bugs"
Set "fix_applied": true and "fix_commit": "{commit_hash}" for each fixed bug.
{ELSE}
Do NOT modify any files. Report only. Set "fix_applied": false for all bugs.
{END IF}

Working directory: {repo_root}
"""

Dispatch using Agent tool:
- isolation: worktree
- model: sonnet (fast, cost-effective for auditing)
- run_in_background: true

Track all agent IDs for collection.
```

- [ ] **Step 7: Write Phase 5 — Collect + Retry**

```markdown
As each agent completes (background notification):
1. Read the agent's result
2. If "Prompt is too long" → re-split the zone in half, relaunch 2 smaller agents
3. If successful → read the zone JSON from the worktree
4. Track completed vs pending

When all agents complete:
1. If fix mode: merge each worktree branch into main
   - `git merge {branch} --no-edit`
   - On conflict: `git checkout --theirs {file} && git add {file}` for files in the agent's zone scope
   - For conflicts outside zone scope: log for user attention
2. Clean up worktrees and branches
```

- [ ] **Step 8: Write Phase 6 — Aggregate + Report**

```markdown
1. Read all zone JSON files
2. Merge into single audit-results.json:
   - Combine all bugs arrays
   - Compute summary (total, by_severity, by_category, files_audited, files_modified, duration)
   - Derive impacted_routes: for each bug, map file path to likely route
     - components/dashboard/* → /dashboard
     - routes/dossier/* → /dossier
     - Use framework-specific route mapping if detected
3. Write audit-results.json to {results_dir}/
4. Print summary table to terminal
5. Suggest next steps:
   - "/visual-run --from-audit" to visually verify impacted routes
   - "/visual-review" to see the full dashboard
```

- [ ] **Step 9: Write the multi-round loop**

```markdown
If mode requires multiple rounds (deep=2, paranoid=3):
1. After round N completes and merges, start round N+1
2. Round N+1 agents receive a DIFFERENT prompt (R2 or R3 focus from checklists.md)
3. Round N+1 agents also receive: "A previous audit already fixed bugs. Verify those fixes are correct AND find deeper issues."
4. Results from all rounds are combined in the same audit-results.json
5. Bug IDs include round number: r1-z03-001, r2-z03-001, etc.
```

- [ ] **Step 10: Commit**

```bash
git add plugins/agentic-visual-debugger/skills/code-audit/SKILL.md
git commit -m "feat: add /code-audit skill — parallel codebase audit"
```

---

### Task 2: Create the language checklists reference

**Files:**
- Create: `plugins/agentic-visual-debugger/skills/code-audit/references/checklists.md`

- [ ] **Step 1: Write round focus descriptions**

```markdown
## Round Focus Descriptions

### R1 — Surface (all modes)
Find known bug patterns. Think like a strict linter.
- Silent exceptions (except: pass, except without logging)
- Missing input validation
- Unguarded array/list indexing
- Dead code, unused imports
- Resource leaks (unclosed connections, missing cleanup)
- Type mismatches

### R2 — Depth (deep + paranoid)
Find runtime behavior bugs. Think like a senior reviewer doing integration testing.
- Race conditions, concurrent access without locks
- Cross-module integration: caller sends X, callee expects Y
- Auth/authorization gaps
- State management bugs
- Error propagation: errors swallowed or misreported
- SSR/hydration issues (web frameworks)

### R3 — Edge Cases (paranoid only)
Find what R1+R2 missed. Think like a security auditor + QA tester.
- Logic errors: wrong boolean, off-by-one, operator precedence
- Prompt injection, SQL injection, path traversal
- Null propagation chains (A calls B calls C, C returns null)
- Data corruption on partial failure
- Performance: O(n^2) loops, unbounded growth
- Accessibility gaps
```

- [ ] **Step 2: Write Python checklist**

```markdown
## Python Checklist

- `except Exception: pass` or `except: pass` — must log at minimum
- `except Exception:` that catches too broadly (catching SystemExit, KeyboardInterrupt)
- `list[0]` / `dict["key"]` on data from external sources without length/existence check
- Direct filesystem access (open(), Path()) where storage abstraction should be used
- `asyncio.get_event_loop()` (deprecated) instead of `get_running_loop()`
- Blocking calls (subprocess.run, time.sleep, synchronous I/O) inside async functions
- Threading: shared mutable state without locks
- Missing `async with` / `async for` on async context managers/iterators
- f-strings in logger calls (eager formatting even when log level disabled)
- Response model class defined after the route that uses it (FastAPI NameError)
```

- [ ] **Step 3: Write TypeScript/React checklist**

```markdown
## TypeScript/React Checklist

- Zustand selector `|| []` or `|| {}` (creates new reference each call → infinite re-renders)
- API response used as array without null check + Array.isArray guard
- `structuredClone` on state containing functions
- useEffect missing cleanup (intervals, event listeners, AbortController)
- useCallback/useMemo missing dependencies (stale closures)
- `as any` type assertions hiding real type errors
- `key={index}` on lists that can reorder
- Direct `window`/`document`/`localStorage` access without SSR guard
- Context providers with inline object values (new reference each render)
- Feature flags using dynamic env var access (must be static in Next.js)
```

- [ ] **Step 4: Write Infra checklist**

```markdown
## Infrastructure Checklist

- Missing `depends_on` between services that need startup ordering
- Missing healthchecks or wrong healthcheck configuration
- Missing memory/CPU limits (OOM kill risk)
- Secrets without `:?` fail-fast guard (silently empty on missing env var)
- Ports in code that don't match docker-compose port mappings
- Env vars referenced in code but not set in compose
- Container running as root without `security_opt: no-new-privileges`
- Missing log rotation (unbounded JSON logs fill disk)
- Hardcoded localhost URLs that break inside Docker networking
- Volume mounts pointing to non-existent paths
```

- [ ] **Step 5: Write Go, Rust, JVM checklists**

```markdown
## Go Checklist

- Unchecked error return: `val, _ := fn()` or `fn()` without checking error
- Goroutine leak: goroutine started without cancellation context
- Nil pointer dereference on interface values
- defer in loop (resource held until function returns, not loop iteration)
- Race condition: shared state without mutex or channel

## Rust Checklist

- `.unwrap()` on Result/Option in library code (should propagate with ?)
- `unsafe` blocks without safety comment explaining invariants
- `.clone()` on large data where borrow would suffice
- Missing error context (use `.context()` or `.map_err()`)
- Deadlock: multiple mutex locks acquired in inconsistent order

## JVM Checklist

- Null passed where non-null expected (missing @Nullable annotation)
- Resource not closed (Closeable without try-with-resources)
- Mutable shared state without synchronization
- Catching Exception/Throwable too broadly
- Hardcoded credentials or connection strings
```

- [ ] **Step 6: Commit**

```bash
git add plugins/agentic-visual-debugger/skills/code-audit/references/checklists.md
git commit -m "feat: add language-specific audit checklists for /code-audit"
```

---

### Task 3: Add Code Audit tab to visual-review build script

**Files:**
- Modify: `plugins/agentic-visual-debugger/skills/visual-review/build-review.mjs`

- [ ] **Step 1: Add audit-results.json detection**

After the existing screenshot/manifest loading, add code to:
1. Check if `audit-results.json` exists in the results directory
2. If yes, parse it and log the bug count
3. Store the parsed data for injection into the HTML template

- [ ] **Step 2: Inject audit data into the HTML template**

Add a `{{AUDIT_DATA}}` placeholder replacement alongside the existing `{{CARDS_DATA}}`. If no audit data exists, inject `null`.

- [ ] **Step 3: Commit**

```bash
git add plugins/agentic-visual-debugger/skills/visual-review/build-review.mjs
git commit -m "feat: build-review reads audit-results.json for Code Audit tab"
```

---

### Task 4: Add Code Audit tab to HTML review template

**Files:**
- Modify: `plugins/agentic-visual-debugger/skills/visual-review/_review-template.html`

- [ ] **Step 1: Add tab navigation in the header**

Add Visual Tests / Code Audit tab buttons after the existing header stats. The Code Audit tab button is hidden by default and shown only when audit data exists.

- [ ] **Step 2: Add the audit panel HTML structure**

After the existing `#grid` div, add an audit panel with:
- Severity filter buttons
- Category filter buttons  
- Search input
- Export CSV button
- Stats bar
- Grid container for bug cards

- [ ] **Step 3: Add audit card CSS**

Style the bug cards with:
- Left border color by severity (critical=red, high=orange, medium=yellow, low=gray)
- Same dark 3D card style as screenshot cards
- Fixed/Unfixed badges
- Category badges
- Expandable description on click
- Hover transform effect

- [ ] **Step 4: Add JavaScript for audit tab**

Implement using safe DOM manipulation (textContent for user data, createElement for structure):
- `switchTab(tab)` — toggle between visual and audit panels
- `renderAuditStats()` — display summary badges
- `renderAuditFilters()` — build severity + category filter buttons
- `filterAuditSeverity(sev)` / `filterAuditCategory(cat)` — filter state
- `applyAuditFilters()` — filter bugs by severity + category + search text
- `renderAuditGrid(bugs)` — render bug cards with safe escaping (textContent, not raw string interpolation)
- `exportAuditCSV()` — generate and download CSV blob

**Security note:** All audit data comes from local JSON files generated at build time. Use the existing `esc()` helper for any data rendered as HTML. Use textContent where possible for plain text content.

- [ ] **Step 5: Commit**

```bash
git add plugins/agentic-visual-debugger/skills/visual-review/_review-template.html
git commit -m "feat: add Code Audit tab to visual-review page"
```

---

### Task 5: Add `--from-audit` flag to visual-run

**Files:**
- Modify: `plugins/agentic-visual-debugger/skills/visual-run/SKILL.md`

- [ ] **Step 1: Add the `--from-audit` invocation**

In the invocations table, add:

```markdown
| `/visual-run --from-audit` | Read `audit-results.json`, extract `impacted_routes`, find matching test manifests, run only those |
```

- [ ] **Step 2: Document the from-audit flow**

```markdown
### From-Audit Mode

When `--from-audit` is passed:

1. Read `{results_dir}/audit-results.json`
2. Extract `impacted_routes` array
3. For each route, find matching YAML manifests by URL path
4. If no manifest matches a route, generate one using `/visual-discover --scope`
5. Run matched + generated manifests (highest severity routes first)
6. Report which code-audit findings were visually confirmed vs not reproduced
```

- [ ] **Step 3: Commit**

```bash
git add plugins/agentic-visual-debugger/skills/visual-run/SKILL.md
git commit -m "feat: add --from-audit flag to /visual-run for code→visual handoff"
```

---

### Task 6: Update plugin metadata and README

**Files:**
- Modify: `plugins/agentic-visual-debugger/.claude-plugin/plugin.json`
- Modify: `README.md`

- [ ] **Step 1: Update plugin.json**

```json
{
  "name": "shipguard",
  "description": "ShipGuard — AI-powered code audit + visual E2E testing. Audit the code first, verify visually second. Zero tests written.",
  "version": "2.0.0",
  "author": {
    "name": "bacoco"
  }
}
```

- [ ] **Step 2: Update README.md**

Add the code-audit section. Document the full ShipGuard flow:

```
/code-audit                    # Find bugs in code
/visual-run --from-audit       # Verify impacted routes visually
/visual-review                 # See everything in one dashboard
```

Add the modes table (quick/standard/deep/paranoid).

- [ ] **Step 3: Update marketplace.json**

```json
{
  "name": "shipguard",
  "description": "AI-powered code audit + visual E2E testing. Zero tests written."
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/agentic-visual-debugger/.claude-plugin/plugin.json README.md .claude-plugin/marketplace.json
git commit -m "feat: rebrand to ShipGuard v2.0.0 + update README with /code-audit"
```

---

### Task 7: End-to-end verification

**Files:**
- No files created — manual verification

- [ ] **Step 1: Run /code-audit quick on a small test project**

Find or create a small repo with known bugs (e.g., a Python file with `except: pass` and a TS file with `|| []`). Run `/code-audit quick` and verify:
- Stack detection identifies Python + TypeScript
- Zones are created correctly
- Agents dispatch and complete
- JSON output matches schema
- Bugs are found and fixed

- [ ] **Step 2: Run /visual-review and verify Code Audit tab**

After audit completes, run `/visual-review` and check:
- Tab appears with bug count badge
- Filters work (severity, category)
- Search works
- Cards display correctly
- CSV export works

- [ ] **Step 3: Run /visual-run --from-audit**

Verify that impacted routes from the audit are used to scope visual tests.

- [ ] **Step 4: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end testing"
```
