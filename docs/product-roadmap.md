# ShipGuard Product Roadmap

## Shipped in v2.0.0

### Skills
- `sg-code-audit` -- parallel AI codebase audit (find + fix bugs)
- `sg-visual-run` -- execute visual test manifests with hybrid scripted+LLM assertions
- `sg-visual-review` -- interactive HTML dashboard (Visual Tests + Code Audit tabs)
- `sg-visual-discover` -- codebase exploration to generate YAML test manifests
- `sg-visual-fix` -- process annotated screenshots, trace to source, implement fixes
- `sg-visual-review-stop` -- stop the review HTTP server

### Core Capabilities
- **Parallel agent dispatch with worktree isolation** -- each agent works in its own git worktree, no file conflicts
- **Multi-round audit** -- R1 surface (lint-like patterns) / R2 depth (runtime behavior) / R3 edge cases (security, logic)
- **Unified dashboard** -- Visual Tests tab (screenshots, annotations, lightbox) + Code Audit tab (bug cards, severity filters, CSV export)
- **Code-to-visual handoff** -- `sg-visual-run --from-audit` reads `impacted_routes` from audit results and runs only matching visual tests
- **7 language checklists** -- Python, TypeScript/React, Next.js, Infrastructure, Go, Rust, JVM

### Modes
| Mode | Agents | Rounds |
|------|--------|--------|
| quick | 5 | 1 (R1) |
| standard | 10 | 1 (R1) |
| deep | 15 | 2 (R1+R2) |
| paranoid | 20 | 3 (R1+R2+R3) |

---

## Known Limitations

- **Zone discovery uses file count heuristic, not AST** -- directories are split by file count thresholds (<=30, 31-80, 80+), not by analyzing code structure
- **Route detection is best-effort** -- impacted routes are derived from file paths using framework-specific patterns (Next.js App Router, Pages Router, React Router), with a generic fallback for unrecognized frameworks
- **No CI/CD integration yet** -- audits run interactively via Claude Code skills, no GitHub Actions workflow
- **No diff-mode** -- audits scan the full codebase (or `--focus` scope), cannot yet audit only git-changed files

---

## Roadmap

### Diff-mode: audit only git-changed files
Scope the audit to files changed since a base branch (`--diff=main`). Reduces agent count and token cost for incremental reviews.

### CI integration: GitHub Actions workflow
A reusable workflow that runs `sg-code-audit` on PRs and posts a summary comment with severity counts and impacted routes.

### Severity confidence scores
Each bug gets a confidence score (0-1) based on pattern match strength, cross-file corroboration, and checklist specificity. Allows filtering out low-confidence findings.

### Custom checklist injection
Users provide a `checklists/custom.md` file with project-specific patterns. These are merged with the built-in language checklists during agent prompt construction.
