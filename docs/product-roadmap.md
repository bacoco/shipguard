# ShipGuard Product Roadmap

## Shipped in v2.0.0

### Core Capabilities
- **Parallel agent dispatch with worktree isolation** -- each agent works in its own git worktree, no file conflicts
- **Multi-round audit** -- R1 surface (lint-like patterns) / R2 depth (runtime behavior) / R3 edge cases (security, logic)
- **Unified dashboard** -- Visual Tests tab (screenshots, annotations, lightbox) + Code Audit tab (bug cards, severity filters, CSV export) + Monitor tab (live Gantt timeline of audit agents)
- **Code-to-visual handoff** -- `sg-visual-run --from-audit` reads `impacted_routes` from audit results and runs only matching visual tests
- **7 language checklists** -- Python, TypeScript/React, Next.js, Infrastructure, Go, Rust, JVM

### Modes
| Mode | Agents | Rounds |
|------|--------|--------|
| quick | 5 | 1 (R1) |
| standard | 10 | 1 (R1) |
| deep | 15 | 2 (R1+R2) |
| paranoid | 20 | 3 (R1+R2+R3) |

## Shipped in v2.2.0

### 4th Module: Self-Improving Engine
- **sg-improve** -- post-session retrospective: extracts learnings, saves to `.shipguard/learnings.yaml` + `mistakes.md`, files GitHub issues. Snapshot/rollback for safety.
- **sg-scout** -- GitHub intelligence: scans ecosystem for techniques, scores relevance, files proposals. Techniques library accumulation.
- **sg-record** -- macro recorder: capture browser interactions as replayable YAML test manifests

### Self-Improvement Loop
- `.shipguard/learnings.yaml` -- zone hints, audit patterns, noise filters, infra timing, success patterns
- `.shipguard/mistakes.md` -- human-readable error journal, referenced from CLAUDE.md, read at every session
- Snapshot/rollback -- `--rollback` undoes last sg-improve, `--history` lists all snapshots
- Techniques library -- `docs/scout-reports/techniques-library.md` with scored techniques from ecosystem

---

## Known Limitations

- **Zone discovery uses file count heuristic, not AST** -- directories are split by file count thresholds (<=30, 31-80, 80+), not by analyzing code structure or token weight
- **Route detection is best-effort** -- impacted routes are derived from file paths using framework-specific patterns
- **No CI/CD integration yet** -- audits run interactively via Claude Code skills
- **Single-model per run** -- all agents use the same model (sonnet), no haiku/sonnet mixing
- **No post-merge validation** -- syntax errors from worktree merges are not caught automatically
- **Skipped zones are not persisted** -- context overflows and API failures don't carry over to the next audit

---

## v3.0 Roadmap — 18 improvements in 4 sprints

*Source: [#38](https://github.com/bacoco/ShipGuard/issues/38) (13 tactical) + [#39](https://github.com/bacoco/ShipGuard/issues/39) (5 structural) + techniques-library*

### Sprint 1 — Critical Path (eliminate crashes + waste)

| # | What | Why | Effort | Issue |
|---|------|-----|--------|-------|
| S1.1 | **Post-merge syntax validation** (Phase 5.5) | IndentationError crashed an API service after merge | Medium | #38.3, #39.4 |
| S1.2 | **Zone sizing by token weight** (not just file count) | 30% overflow rate on first dispatch | Medium | #38.1 |
| S1.3 | **Retry exponential backoff** (30s→60s→120s) | 529 retries compete for same capacity | Easy | #38.2 |
| S1.4 | **Duplicate agent tracking** (_dispatch_log.json) | Two agents did same work, later one overwrote results | Easy | #38.4 |
| S1.5 | **Zone JSON naming enforcement** | Agents use inconsistent filenames | Trivial | #38.6 |

### Sprint 2 — Audit Quality (+40% bugs found per pass)

| # | What | Why | Effort | Issue |
|---|------|-----|--------|-------|
| S2.1 | **Infra = mandatory dedicated zone** | 42% of bugs were infra but it got one catch-all zone | Easy | #39.5 |
| S2.2 | **"Re-check patterns" instead of "NEW only"** | Agents self-censor known patterns across zones | Easy | #39.2 |
| S2.3 | **Multi-model: haiku R1, sonnet R2+** | Sonnet self-censors bulk low-severity findings | Medium | #39.3 |
| S2.4 | **Noise batching** (f-strings, key={i} static) | 13% of findings are low-value noise | Easy | #38.10 |
| S2.5 | **Skipped zones persisted** (_skipped_zones.json) | Zones that crash are invisible to next audit | Medium | #39.1 |
| S2.6 | **impacted_routes: UI vs API split** | Non-URL routes can't match visual tests | Easy | #38.11 |

### Sprint 3 — UX & Visual Run (developer friction)

| # | What | Why | Effort | Issue |
|---|------|-----|--------|-------|
| S3.1 | **Session expiry detection** (URL check after open) | Silent redirect to / mid-test | Easy | #38.7 |
| S3.2 | **Monitor default off** (opt-in --monitor) | Question adds friction for solo devs | Trivial | #38.8 |
| S3.3 | **Smarter scope question** (show estimated time) | Diff analysis wasted when user picks "full" | Easy | #38.9 |
| S3.4 | **Browser collision prevention** (bold warning) | Parallel agent-browser calls collide | Easy | #38.5 |
| S3.5 | **Worktree branch cleanup** (git branch -d) | Stale branches after audit | Trivial | #38.12 |

### Sprint 4 — Advanced (techniques from ecosystem)

| # | What | Why | Effort | Source |
|---|------|-----|--------|--------|
| S4.1 | **Prompt hash pinning** (SHA256 baseline tracking) | Detect when prompt changes invalidate baselines | Medium | techniques-library |
| S4.2 | **Strict output contract + retry** (JSON schema) | Malformed zone JSON accepted silently | Medium | techniques-library |
| S4.3 | **N-parallel confidence runs** (2 agents/zone) | Reduce false positives via consensus | High | techniques-library |
| S4.4 | **CI integration** (GitHub Actions) | No automated PR audit | High | roadmap |
| S4.5 | **Cross-session learning analytics** (dashboard) | No visibility into learning accumulation | High | roadmap |

### Execution Order

```
S1 (1 session)  →  S2.1+S2.2+S2.4 (30 min)  →  S2.3 (1h)  →  S2.5+S2.6 (30 min)  →  S3 (30 min)  →  S4 (when stable)
```

### Impact Projection

```
Before v3:  Pass 1 ~50 bugs → Pass 2 ~30 → Pass 3 ~15 → Pass 4 ~8 → Pass 5+ ~3
After v3:   Pass 1 ~70 bugs → Pass 2 ~15 → Pass 3 ~5 (noise floor)
```

Fewer passes to reach confidence = less time, less tokens, happier users.
