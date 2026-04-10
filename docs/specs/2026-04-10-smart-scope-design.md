# ShipGuard Smart Scope — Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Overview

Add unified "smart scope" to the 3 main ShipGuard skills: `sg-code-audit`, `sg-visual-run`, `sg-visual-discover`. When invoked without arguments, each skill auto-detects what changed (via git diff), proposes the scope to the user, and operates on just the impacted files/routes instead of the full codebase.

## Motivation

Every audit, test run, and discovery scan currently operates on the entire codebase. For a typical PR touching 5 files out of 300, this wastes ~95% of tokens and time. Smart scope makes ShipGuard viable for CI/CD integration and daily developer workflow.

## Behavior

### Scope Detection

When any of the 3 skills is invoked **without `--all` or `--diff=<ref>`**, it:

1. **Detects the base reference automatically:**
   - If on a feature branch → `main` or `master` (whichever exists)
   - If on main/master → `HEAD~1` (last commit)
   - If remote tracking branch exists → `origin/{current_branch}`

2. **Runs `git diff --name-only {base}` to get modified files**

3. **Asks the user via AskUserQuestion:**

   If changes are detected:
   > "I detected changes since `{base}` ({N} files modified). What scope?"
   >
   > 1. **Only what changed** — {N} files + their importers (~{M} files total)
   > 2. **Full codebase** — everything
   > 3. **Different base** — specify a branch or commit

   If no changes detected:
   > "No uncommitted changes. Audit the last commit `{sha}: {message}`?"
   >
   > 1. **Last commit** — {N} files changed
   > 2. **Full codebase**
   > 3. **Different base**

4. **If the user picks "Different base"**, ask for the ref (branch name, commit SHA, or tag).

### Flags (Override)

All 3 skills accept the same flags:

| Flag | Behavior |
|------|----------|
| (no flag) | Interactive — auto-detect + ask user |
| `--all` | Skip the question, run on full codebase |
| `--diff=<ref>` | Skip the question, use specified base reference |

These flags are parsed BEFORE any existing flag parsing. They are compatible with existing flags like `--focus`, `--report-only`, `--from-audit`, etc.

### Import Graph Expansion (1 Level)

For `sg-code-audit` in diff mode, the scope is not just the modified files — it includes their **direct importers** (files that import a modified file). This catches bugs in callers that may break due to the change.

Detection method:
```bash
# For each modified file, find who imports it
grep -rl "from.*['\"].*{filename_stem}" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" .
grep -rl "require(.*{filename_stem}" --include="*.js" --include="*.ts" .
```

Simple grep on import statements. No AST, no module resolution. Covers ~90% of cases. TypeScript path aliases and webpack resolve aliases are edge cases ignored in v1.

The expanded file list is reported to the user:
> "12 files modified + 16 importers = 28 files to audit"

## Per-Skill Behavior

### sg-code-audit

1. Parse `--all` / `--diff=<ref>` flags
2. If neither present → run scope detection + ask user
3. If "only what changed" → git diff + import expansion → file list
4. Zone discovery operates ONLY on the scoped file list (not the full repo)
5. Agent prompt includes: "These files were recently modified: {list}. Their direct importers are also included. Pay special attention to changes that may have introduced bugs."
6. `audit-results.json` includes a new field: `"scope": "diff"` or `"scope": "full"` + `"base_ref": "main"` + `"files_in_scope": 28`

### sg-visual-run

1. Parse `--all` / `--diff=<ref>` flags
2. If neither present AND no other arguments (no natural language, no `--from-audit`, no `--regressions`) → run scope detection + ask user
3. If "only what changed" → git diff → route detection (same framework-specific logic as `impacted_routes` in code-audit) → match to YAML manifests
4. Regressions from `_regressions.yaml` are ALWAYS included regardless of scope
5. If no manifest matches a changed route → log "uncovered route: {route}"
6. Existing modes (natural language, --from-audit, --regressions) work unchanged — smart scope only activates when NO arguments are provided

### sg-visual-discover

1. Parse `--all` / `--diff=<ref>` flags
2. If neither present → run scope detection + ask user
3. If "only what changed" → git diff → route detection → identify impacted routes
4. Generate or update ONLY the manifests for impacted routes
5. Do NOT touch manifests for non-impacted routes (no accidental overwrites)
6. If a route has an existing manifest → update it (re-scan the route's components)
7. If a route has no manifest → generate a new one
8. Report: "Updated 2 manifests, created 1 new manifest, 92 manifests unchanged"

## Base Detection Algorithm

```
function detectBase():
  current_branch = git rev-parse --abbrev-ref HEAD

  if current_branch != "main" AND current_branch != "master":
    # Feature branch — diff vs main
    if branch "main" exists:
      return "main"
    elif branch "master" exists:
      return "master"
    else:
      return "HEAD~1"  # fallback

  else:
    # On main/master — diff vs last commit
    return "HEAD~1"
```

If the detected base has no diff (0 files changed), fall back to "No uncommitted changes" flow with the last commit option.

## Output Schema Changes

### audit-results.json — new fields

```json
{
  "scope": "diff",
  "base_ref": "main",
  "files_in_scope": 28,
  "files_modified": 12,
  "files_importers": 16,
  ...existing fields...
}
```

When `scope` is `"full"`, `base_ref`, `files_modified`, and `files_importers` are omitted.

## Edge Cases

1. **Binary files in diff** — skip them (images, fonts, compiled assets)
2. **Deleted files in diff** — include their importers (callers may break)
3. **Renamed files** — treat as modified (new path) + deleted (old path)
4. **Merge commits** — diff vs merge base, not just parent
5. **Uncommitted changes** — `git diff HEAD` (includes staged + unstaged)
6. **No git repo** — skip smart scope, fall back to full codebase with warning
7. **Huge diff (100+ files)** — still propose "only what changed" but warn: "Large diff (142 files). Consider --all for a full audit."

## What This Does NOT Change

- Existing `--focus=path/` flag works unchanged (manual scope override)
- `--from-audit` mode works unchanged (reads audit-results.json)
- `--report-only` works unchanged
- Mode selection (quick/standard/deep/paranoid) works unchanged
- The scope question is asked ONCE at the beginning, not per-round in multi-round mode
- Zone discovery algorithm stays the same (file count thresholds), just operates on a smaller file set

## Out of Scope

- AST-based import resolution (v2)
- Multi-level import expansion (only 1 level in v1)
- TypeScript path alias resolution
- Automatic CI/CD integration (separate feature)
- Confidence scores on findings (separate feature)
