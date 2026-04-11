/**
 * actions-to-yaml.mjs
 *
 * Converts an array of recorded browser actions into a ShipGuard YAML manifest string.
 * Pure data transformation — no side effects, fully testable.
 */

const LLM_CHECK_THRESHOLD = 80;

/**
 * Remove the baseUrl prefix from a URL, returning the relative path.
 * @param {string} url
 * @param {string} baseUrl
 * @returns {string}
 */
function stripBase(url, baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  if (url.startsWith(base)) {
    const path = url.slice(base.length);
    return path || '/';
  }
  return url;
}

/**
 * Escape a string for safe embedding in a YAML double-quoted string.
 * Escapes backslashes, double-quotes, and newlines.
 * @param {string} str
 * @returns {string}
 */
function escYaml(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Convert a recorded actions array into a ShipGuard YAML manifest string.
 *
 * @param {Array<{type: string, url?: string, text?: string, selector?: string, value?: string, files?: string[], elementTag?: string}>} actions
 * @param {{ name: string, baseUrl: string }} opts
 * @returns {string}
 */
export function actionsToYaml(actions, opts) {
  const { name, baseUrl } = opts;
  const recordedAt = new Date().toISOString();

  // Determine requires_auth: false only when the first open action points to /login
  const firstOpen = actions.find(a => a.type === 'open');
  const firstPath = firstOpen ? stripBase(firstOpen.url || '', baseUrl) : '/';
  const requiresAuth = !firstPath.startsWith('/login');

  // Build header
  const lines = [];
  lines.push(`name: "${escYaml(name)}"`);
  lines.push(`description: "Recorded session for ${escYaml(name)}"`);
  lines.push(`priority: medium`);
  lines.push(`requires_auth: ${requiresAuth}`);
  lines.push(`timeout: 60s`);
  lines.push(`tags: [recorded]`);
  lines.push(`source: recorded`);
  lines.push(`recorded_at: "${recordedAt}"`);
  lines.push(``);
  lines.push(`steps:`);

  // Track whether last emitted step was a check (to decide trailing screenshot)
  let lastWasCheck = false;
  let screenshotCounter = 0;

  for (const action of actions) {
    switch (action.type) {
      case 'open': {
        const relativePath = stripBase(action.url, baseUrl);
        lines.push(`  - action: open`);
        lines.push(`    url: "{base_url}${relativePath}"`);
        lastWasCheck = false;
        break;
      }

      case 'click': {
        const target = action.text || action.selector || '';
        lines.push(`  - action: click`);
        lines.push(`    target: "${escYaml(target)}"`);
        lastWasCheck = false;
        break;
      }

      case 'fill': {
        const target = action.text || action.selector || '';
        const value = action.value || '';
        lines.push(`  - action: fill`);
        lines.push(`    target: "${escYaml(target)}"`);
        lines.push(`    value: "${escYaml(value)}"`);
        lastWasCheck = false;
        break;
      }

      case 'select': {
        const target = action.text || action.selector || '';
        const value = action.value || '';
        lines.push(`  - action: select`);
        lines.push(`    target: "${escYaml(target)}"`);
        lines.push(`    value: "${escYaml(value)}"`);
        lastWasCheck = false;
        break;
      }

      case 'upload': {
        lines.push(`  - action: upload`);
        // sg-visual-run expects `file:` (singular path). Runner finds the input via snapshot.
        const uploadFile = (action.files && action.files[0]) || action.file || '';
        if (uploadFile) {
          lines.push(`    file: "${escYaml(uploadFile)}"`);
        }
        lastWasCheck = false;
        break;
      }

      case 'check': {
        const text = action.text || '';
        if (text.length > LLM_CHECK_THRESHOLD) {
          lines.push(`  - action: llm-check`);
          lines.push(`    description: "Verify element content"`);
          lines.push(`    criteria: "The ${escYaml(action.elementTag || 'element')} should contain text similar to: ${escYaml(text.slice(0, 120))}..."`);
          lines.push(`    severity: medium`);
        } else {
          lines.push(`  - action: assert_text`);
          lines.push(`    expected: "${escYaml(text)}"`);
        }
        // Auto screenshot after each check
        screenshotCounter++;
        lines.push(`  - action: screenshot`);
        lines.push(`    filename: "check-${screenshotCounter}.png"`);
        lastWasCheck = true;
        break;
      }

      default:
        // Unknown action types: emit as comment
        lines.push(`  # unknown action: ${action.type}`);
        lastWasCheck = false;
        break;
    }
  }

  // Trailing screenshot if last action wasn't a check
  if (!lastWasCheck) {
    lines.push(`  - action: screenshot`);
    lines.push(`    filename: "final.png"`);
  }

  return lines.join('\n') + '\n';
}
