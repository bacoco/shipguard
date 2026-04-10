# ShipGuard Monitor Tab — Design Spec

**Date:** 2026-04-10
**Status:** Approved

## Overview

Add a "Monitor" tab to the ShipGuard review dashboard that shows real-time and post-hoc audit progress: a Gantt timeline of agent execution, token usage, estimated cost, and bugs found per zone. The data comes from sg-code-audit reporting lifecycle events to the existing review server.

## Problem

When sg-code-audit dispatches 5-20 parallel agents, the user has no visibility into what's happening. They wait in the terminal for completion messages. If an agent is slow, crashes, or hits a context overflow, they only find out after the fact. There is no way to see the cost of an audit in tokens or dollars.

## Solution

Two-layer architecture:

| Layer | Source | Setup | Data |
|-------|--------|-------|------|
| **L1 — Direct** | sg-code-audit posts HTTP events to the review server | Zero setup — always works | Gantt, tokens, cost, bugs/zone |
| **L2 — OTLP** (future) | Claude Monitor exports OpenTelemetry events | One-time env var setup | Real-time tool-level detail, API latency |

**L1 is the MVP.** L2 is a future enhancement documented here for forward-compatibility.

## Key Constraint: Claude Monitor Doesn't Start a Server

Claude Code's telemetry system is a **client-only exporter**. It sends data TO an endpoint you configure via environment variables. It does NOT start any background process. If the env vars are not set, nothing happens.

Furthermore, OTLP env vars must be set BEFORE the Claude Code session starts — they cannot be activated mid-session. This makes OTLP unsuitable as the sole data source for a feature that must work immediately without setup.

However, the Agent tool already returns `total_tokens`, `tool_uses`, and `duration_ms` in each agent's completion result. sg-code-audit can extract this data and report it to the monitor server without any OTLP dependency.

## Activation Flow

```
sg-code-audit starts
  │
  ├── GET http://localhost:8888/health
  │     │
  │     ├── 200 OK
  │     │   └── Server already running → monitoring active silently
  │     │
  │     └── Connection refused → server not running
  │           │
  │           └── Ask user (AskUserQuestion):
  │               "Voulez-vous suivre l'avancement de l'audit
  │                en temps réel dans un tableau de bord ? (oui/non)"
  │                 │
  │                 ├── oui → start server:
  │                 │     node visual-tests/build-review.mjs --serve
  │                 │     (path resolved from results_dir — same logic as Phase 6)
  │                 │     wait for GET /health to return 200 (retry 3x, 1s apart)
  │                 │     → monitoring active
  │                 │
  │                 └── non → proceed without monitoring
  │
  ├── POST /api/monitor/audit-start (if monitoring active)
  │
  ├── [dispatch agents — Phase 4 unchanged]
  │
  ├── On each agent completion:
  │     POST /api/monitor/agent-update
  │     (extract tokens/tools/duration from Agent result footer)
  │
  └── POST /api/monitor/audit-complete
```

The question uses plain language, no jargon. "Suivre l'avancement en temps réel" — not "enable telemetry" or "start OTLP collector".

## API Endpoints (build-review.mjs)

All monitor endpoints are added to the existing HTTP server on port 8888.

### `GET /health`

Returns `200 OK` with `{"status": "ok"}`. Used by sg-code-audit to detect if the server is running.

### `POST /api/monitor/audit-start`

Called once when an audit begins. Resets any previous monitor state.

Request body:
```json
{
  "mode": "standard",
  "round_count": 1,
  "agent_count": 10,
  "zones": [
    {"zone_id": "z01", "paths": ["src/routes/"], "file_count": 28},
    {"zone_id": "z02", "paths": ["src/hooks/", "src/stores/"], "file_count": 22}
  ],
  "scope_mode": "diff",
  "scope_ref": "main",
  "timestamp": "2026-04-10T14:30:00Z"
}
```

Response: `200 {"ok": true}`

Server behavior: creates a new in-memory monitor state with `status: "running"`, writes initial `monitor-data.json`.

### `POST /api/monitor/agent-update`

Called when an agent starts, completes, fails, or overflows.

Request body:
```json
{
  "zone_id": "z01",
  "status": "started | completed | failed | overflow",
  "round": 1,
  "started_at": "2026-04-10T14:30:02Z",
  "ended_at": "2026-04-10T14:33:15Z",
  "duration_ms": 193000,
  "tokens": {"total": 42526, "input": 28000, "output": 14526},
  "cost_usd": 0.12,
  "tool_uses": 23,
  "bugs_found": 4,
  "files_audited": 18,
  "error": null
}
```

For `status: "started"`, only `zone_id`, `status`, `round`, and `started_at` are required. Other fields are null/0.

For `status: "overflow"`, include `error: "context overflow — re-splitting"` and the new zone IDs:

```json
{
  "zone_id": "z05",
  "status": "overflow",
  "round": 1,
  "started_at": "2026-04-10T14:30:02Z",
  "ended_at": "2026-04-10T14:31:45Z",
  "duration_ms": 103000,
  "tokens": {"total": 12000, "input": 12000, "output": 0},
  "cost_usd": 0.02,
  "tool_uses": 3,
  "bugs_found": 0,
  "files_audited": 0,
  "error": "context overflow — re-splitting",
  "overflow_into": ["z05a", "z05b"]
}
```

Response: `200 {"ok": true}`

Server behavior: updates the agent entry in memory, recalculates totals, writes `monitor-data.json`.

### `POST /api/monitor/audit-complete`

Called once when the entire audit finishes.

Request body:
```json
{
  "status": "completed",
  "timestamp": "2026-04-10T14:35:12Z"
}
```

Response: `200 {"ok": true}`

Server behavior: sets `status: "completed"`, sets `ended_at`, writes final `monitor-data.json`.

### `GET /api/monitor`

Returns the current `monitor-data.json` content. Used by the review page for live polling.

Response: the full monitor-data.json object, or `404` if no audit has been monitored.

## Data Schema: `monitor-data.json`

Written to `_results/monitor-data.json` (same directory as `audit-results.json` and `review.html`).

```json
{
  "status": "running",
  "mode": "standard",
  "round_count": 1,
  "scope_mode": "diff",
  "scope_ref": "main",
  "started_at": "2026-04-10T14:30:00Z",
  "ended_at": null,
  "agents": [
    {
      "zone_id": "z01",
      "paths": ["src/routes/"],
      "file_count": 28,
      "status": "completed",
      "round": 1,
      "started_at": "2026-04-10T14:30:02Z",
      "ended_at": "2026-04-10T14:33:15Z",
      "duration_ms": 193000,
      "tokens": {"total": 42526, "input": 28000, "output": 14526},
      "cost_usd": 0.12,
      "tool_uses": 23,
      "bugs_found": 4,
      "files_audited": 18,
      "error": null,
      "overflow_into": null
    },
    {
      "zone_id": "z05",
      "paths": ["src/components/"],
      "file_count": 85,
      "status": "overflow",
      "round": 1,
      "started_at": "2026-04-10T14:30:02Z",
      "ended_at": "2026-04-10T14:31:45Z",
      "duration_ms": 103000,
      "tokens": {"total": 12000, "input": 12000, "output": 0},
      "cost_usd": 0.02,
      "tool_uses": 3,
      "bugs_found": 0,
      "files_audited": 0,
      "error": "context overflow",
      "overflow_into": ["z05a", "z05b"]
    }
  ],
  "totals": {
    "tokens": 285000,
    "cost_usd": 0.87,
    "tool_uses": 156,
    "bugs_found": 31,
    "files_audited": 187,
    "duration_ms": 312000
  }
}
```

### Cost Estimation

The agent result footer provides `total_tokens` but not cost. Estimate cost from tokens + model:

| Model | Input (per 1M) | Output (per 1M) |
|-------|----------------|-----------------|
| sonnet | $3.00 | $15.00 |
| opus | $15.00 | $75.00 |
| haiku | $0.25 | $1.25 |

Default to sonnet pricing (sg-code-audit uses `model: sonnet` for agents). If the agent result doesn't split input/output tokens, use the total with a 60/40 input/output ratio estimate.

## Monitor Tab UI

### Tab Button

Third button in the existing tab bar, after "Visual Tests" and "Code Audit":

```html
<button class="tab-btn" id="tab-monitor" onclick="switchTab('monitor')">Monitor</button>
```

Visible only when `monitor-data.json` exists (same pattern as the Code Audit tab for `audit-results.json`).

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Stats Bar                                                  │
│  ⏱ 5m12s  │  285K tokens  │  $0.87  │  31 bugs  │ 10 agents│
├─────────────────────────────────────────────────────────────┤
│  Gantt Timeline                                  time axis →│
│                                                             │
│  z01 src/routes/      ████████████░░░░░░░  4 bugs    $0.12 │
│  z02 src/hooks/       ██████████████████░  7 bugs    $0.15 │
│  z03 src/stores/      ████████░░░░░░░░░░  3 bugs    $0.08 │
│  z04 infra/           ███████████████████████  2 bugs $0.14│
│  z05 src/components/  ██████ ⚡ overflow → z05a + z05b      │
│  z05a src/components/a ████████████████░  3 bugs     $0.09 │
│  z05b src/components/b ██████████████░░░  5 bugs     $0.11 │
│  z06 src/lib/         ████████████████░░  5 bugs     $0.11 │
│  ...                                                        │
│                                                             │
│  ■ running  ■ completed  ■ failed  ■ overflow               │
├─────────────────────────────────────────────────────────────┤
│  Status: Completed — 10 agents, 1 round, 5m12s             │
│  [View Code Audit results →]                                │
└─────────────────────────────────────────────────────────────┘
```

### Stats Bar

Five stat badges, same component style as existing Visual Tests stats:

| Badge | Source |
|-------|--------|
| Duration | `totals.duration_ms` formatted as Xm Ys |
| Tokens | `totals.tokens` formatted as XK |
| Cost | `totals.cost_usd` formatted as $X.XX |
| Bugs | `totals.bugs_found` |
| Agents | `agents.length` (including overflow splits) |

### Gantt Chart

- Each agent is a horizontal bar
- X-axis: time relative to audit start (0s to total duration)
- Bar start: `agent.started_at - audit.started_at`
- Bar end: `agent.ended_at - audit.started_at` (or current time if running)
- Bar width: proportional to duration
- Left label: `zone_id` + first path (truncated)
- Right label: bugs found + cost

### Color Coding

Uses existing CSS variables from the review template:

| Status | Color | CSS |
|--------|-------|-----|
| running | copper (animated pulse) | `var(--primary)` with `animation: pulse` |
| completed | green | `var(--pass)` / `#1a7e40` |
| failed | red | `var(--fail)` / `#ff6b6b` |
| overflow | orange | `var(--stale)` / `#b45309` |

### Overflow Visualization

When an agent overflows:
- Its bar shows truncated with a lightning bolt icon
- Two new bars appear below for the re-split children (z05a, z05b)
- A connector line links parent to children

### Live Polling

When `status === "running"`:
- The page fetches `GET /api/monitor` every 3 seconds
- Running agents show animated bars (pulse animation, growing width)
- Stats update on each poll
- Polling stops when `status` changes to `"completed"` or `"failed"`

When `status === "completed"` or `"failed"`:
- Static view, no polling
- All bars are final width

### Status Footer

Single line at the bottom:
- Running: "Audit in progress — X/Y agents completed"
- Completed: "Completed — X agents, Y rounds, Zm Ws"
- Failed: "Audit failed — X agents completed, Y failed"

If audit data also exists (`audit-results.json`), show a link: "View Code Audit results →" that switches to the Code Audit tab.

## Changes to Existing Files

### `build-review.mjs`

1. Add `GET /health` route — returns `{"status": "ok"}`
2. Add `POST /api/monitor/audit-start` route — resets monitor state, writes initial monitor-data.json
3. Add `POST /api/monitor/agent-update` route — updates agent entry, recalculates totals, writes monitor-data.json
4. Add `POST /api/monitor/audit-complete` route — finalizes monitor state
5. Add `GET /api/monitor` route — returns current monitor state as JSON
6. In the build phase: read `monitor-data.json` from results dir (if exists), inject as `data.monitor` alongside `data.audit`
7. Monitor state is held in a module-level variable (same pattern as the PID file) — no external database

All POST routes accept JSON body. All responses are JSON. CORS headers already present from the `/save-manifest` route.

### `_review-template.html`

1. Add third tab button in `#header-tabs`
2. Add `#monitor-toolbar` (stats bar only — no filters needed)
3. Add `#monitor-layout` with `#monitor-gantt` container
4. Add CSS for Gantt bars, animations, overflow connectors
5. Add `switchTab('monitor')` case in the existing `switchTab()` function
6. Add `initMonitorTab()` in the init sequence
7. Add `renderGantt()`, `renderMonitorStats()`, `pollMonitor()` functions
8. Polling logic: `setInterval` when tab is active and `status === "running"`, cleared on complete

### `sg-code-audit/SKILL.md`

Add a "Phase 0 — Monitor Setup" before the existing Phase 1:

1. Check if review server is running: `GET http://localhost:8888/health`
2. If running: set `monitor_active = true`
3. If not running: ask user "Voulez-vous suivre l'avancement de l'audit en temps réel dans un tableau de bord ? (oui/non)"
4. If yes: start server with `node <visual-tests-path>/build-review.mjs --serve`, wait for health check, set `monitor_active = true`
5. If no: set `monitor_active = false`

Then throughout the existing phases, add conditional POST calls:

- Phase 4 (dispatch): POST `/api/monitor/agent-update` with `status: "started"` for each zone
- Phase 5 (collect): POST `/api/monitor/agent-update` on each agent completion
- Phase 6 (aggregate): POST `/api/monitor/audit-complete`

All monitor calls are conditional on `monitor_active`. If the server goes down mid-audit (POST fails), silently disable monitoring — do not crash the audit.

### `sg-visual-review/SKILL.md`

Add one line to the "What It Does" section mentioning the Monitor tab appears when monitor-data.json exists.

## Persistence

- `monitor-data.json` is overwritten on each new audit (POST `/api/monitor/audit-start` resets state)
- The file lives in `_results/` alongside `audit-results.json` and screenshots
- Not committed to git (same as other _results files)
- History is in git if the user commits audit-results.json

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Server dies mid-audit | POST fails silently, audit continues, no monitor-data.json |
| Agent result has no token data | Set tokens to `{"total": 0, "input": 0, "output": 0}`, cost to 0 |
| Malformed POST body | Return `400 {"error": "..."}`, do not crash server |
| Multiple audits in parallel | Not supported — second audit-start overwrites the first |
| Review page opened with no monitor data | Tab button hidden (same as Code Audit with no audit-results.json) |
| Server not reachable at audit start | User chose "non" or network issue — audit runs normally |

## Out of Scope

- **OTLP Layer 2**: Full OpenTelemetry integration (receiving `POST /v1/logs`, parsing OTel events). Documented as future enhancement, not in this spec.
- **Multi-round Gantt**: For deep/paranoid mode with 2-3 rounds, the Gantt shows all rounds sequentially in one timeline. No per-round tabs or filters.
- **Historical comparison**: No audit history browser. One file, one audit.
- **WebSocket/SSE**: Polling at 3s interval is sufficient. No real-time push protocol.
- **Agent-internal tool timeline**: No breakdown of Read/Edit/Bash per agent. Just the overall agent bar.
