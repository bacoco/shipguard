# e2e-agent-browser

Automated E2E testing for any web app using agent-browser (Playwright CLI).

**Skills:**
- `/e2e-discover` — Explore codebase, detect routes/forms/features, generate YAML test manifests mirroring UI navigation
- `/e2e-run` — Execute tests with hybrid scripted+LLM assertions, mandatory screenshot validation, regression tracking

**Features:**
- Generic (Next.js, React, Vue, Angular)
- Regression-aware (failed tests run first, removed after 3 passes)
- Scope filtering (`--filter scope.txt`)
- Mandatory screenshot validation (every screenshot read + inspected, errors = FAIL)
- Crash recovery + test isolation

**Requires:** `agent-browser` CLI (`npm install -g agent-browser && agent-browser install --with-deps`)
