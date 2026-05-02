#!/usr/bin/env node
/**
 * build-review.mjs — Generate a self-contained HTML review page
 * from Visual test manifests, report, and screenshots.
 *
 * Usage: node visual-tests/build-review.mjs
 * Output: visual-tests/_results/review.html
 *
 * Security note: All data is generated at build time from trusted local
 * YAML files and report.md. The HTML is a static artifact with no user
 * input at runtime. innerHTML is used for rendering pre-sanitized,
 * build-time-escaped strings only.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, relative, basename, dirname } from 'path';
import { execFileSync } from 'child_process';

// Minimal YAML parser — handles flat keys, arrays, nested objects used in test manifests.
// No external dependency needed.
function yamlParse(text) {
  const result = {};
  let currentKey = null;
  let currentArray = null;
  let currentObj = null;
  let inArray = false;   // true when current top-level key holds an array

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level key: value
    const kvMatch = line.match(/^([a-z_][a-z0-9_-]*):\s*(.*)$/i);
    if (kvMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      inArray = false;
      currentArray = null;
      currentObj = null;
      const [, key, rawVal] = kvMatch;
      const val = rawVal.replace(/^["']|["']$/g, '').trim();

      if (key === 'tags' && val.startsWith('[')) {
        result[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
        currentKey = key;
        continue;
      }
      if (val === '' || val === '|' || val === '>') {
        // Empty value — could be an array or a nested object; decide on next line
        // Known limitation: block scalars (| and >) are not supported.
        // ShipGuard manifests don't use them — all values are inline.
        currentKey = key;
        result[key] = null; // placeholder; will be set to [] or {} on first child line
        continue;
      }
      if (val === 'true') { result[key] = true; currentKey = key; continue; }
      if (val === 'false') { result[key] = false; currentKey = key; continue; }
      if (/^-?\d+(\.\d+)?$/.test(val)) { result[key] = parseFloat(val); currentKey = key; continue; }
      result[key] = val;
      currentKey = key;
      continue;
    }

    // Indented line under currentKey
    if (currentKey !== null) {
      // Array item: line starts with optional whitespace + "- "
      const arrayItemMatch = line.match(/^(\s+)-\s+(.*)/);
      if (arrayItemMatch) {
        // First array item — promote placeholder to array if needed
        if (!Array.isArray(result[currentKey])) {
          result[currentKey] = [];
          inArray = true;
          currentArray = result[currentKey];
        }
        const rest = arrayItemMatch[2];
        // Check if item leads with a key (e.g. "- action: foo" or "- test: bar")
        const leadKeyMatch = rest.match(/^([a-z_][a-z0-9_-]*):\s*(.*)/i);
        if (leadKeyMatch) {
          const propVal = leadKeyMatch[2].replace(/^["']|["']$/g, '').trim();
          currentObj = {};
          currentObj[leadKeyMatch[1]] = propVal === '' ? null
            : propVal === 'true' ? true
            : propVal === 'false' ? false
            : /^-?\d+(\.\d+)?$/.test(propVal) ? parseFloat(propVal)
            : propVal;
          currentArray.push(currentObj);
        } else {
          // Plain scalar array item (e.g. "- foo")
          const scalarVal = rest.replace(/^["']|["']$/g, '').trim();
          currentArray.push(scalarVal);
          currentObj = null;
        }
        continue;
      }

      // Property of current array object
      if (inArray && currentObj && typeof currentObj === 'object') {
        const propMatch = line.match(/^\s+([a-z_][a-z0-9_-]*):\s*(.+)/i);
        if (propMatch) {
          const val = propMatch[2].replace(/^["']|["']$/g, '').trim();
          if (val === 'true') currentObj[propMatch[1]] = true;
          else if (val === 'false') currentObj[propMatch[1]] = false;
          else if (/^-?\d+(\.\d+)?$/.test(val)) currentObj[propMatch[1]] = parseFloat(val);
          else currentObj[propMatch[1]] = val;
          continue;
        }
      }

      // Nested key under current top-level key (e.g., data:, credentials:)
      if (!inArray) {
        if (result[currentKey] === null) result[currentKey] = {}; // promote placeholder
        if (typeof result[currentKey] === 'object' && !Array.isArray(result[currentKey])) {
          const nestedMatch = line.match(/^\s+([a-z_][a-z0-9_-]*):\s*(.+)/i);
          if (nestedMatch) {
            const val = nestedMatch[2].replace(/^["']|["']$/g, '').trim();
            result[currentKey][nestedMatch[1]] = val;
          }
        }
      }
    }
  }
  return result;
}

const yaml = { load: yamlParse };

const ROOT = dirname(new URL(import.meta.url).pathname);
const RESULTS_DIR = join(ROOT, '_results');
const SCREENSHOTS_DIR = join(RESULTS_DIR, 'screenshots');
const REPORT_PATH = join(RESULTS_DIR, 'report.md');
const REGRESSIONS_PATH = join(ROOT, '_regressions.yaml');
const CONFIG_PATH = join(ROOT, '_config.yaml');
const OUTPUT_PATH = join(RESULTS_DIR, 'review.html');
const CHANGE_REPORTS_DIR = join(RESULTS_DIR, 'change-reports');
const PERSONA_REPORTS_DIR = join(RESULTS_DIR, 'persona-reports');

// Dynamically discover test categories by scanning subdirectories (fixes #20)
const CATEGORIES = readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.')
    && d.name !== 'lib' && d.name !== 'node_modules' && d.name !== 'manifests')
  .map(d => d.name)
  .sort();

// ── 1. Parse config ──
const config = yaml.load(readFileSync(CONFIG_PATH, 'utf8'));

// ── 2. Parse report.md for status ──
function parseReport() {
  if (!existsSync(REPORT_PATH)) return { statusMap: {} };
  const md = readFileSync(REPORT_PATH, 'utf8');
  const statusMap = {};
  for (const line of md.split('\n')) {
    // Format 1: | test-slug | PASS | or | category/test-slug | PASS |
    let m = line.match(/^\|\s*([a-z0-9_/-]+)\s*\|\s*(?:\*\*)?(PASS|FAIL|STALE)(?:\*\*)?\s*\|/i);
    if (m) { statusMap[m[1]] = m[2].toUpperCase(); continue; }
    // Format 2: - category/test-slug: PASS
    m = line.match(/^-\s+([a-z0-9_/-]+):\s*(PASS|FAIL|STALE)/i);
    if (m) { statusMap[m[1]] = m[2].toUpperCase(); continue; }
  }
  const summaryMatch = md.match(/Tests:\s*(\d+)\s*run,\s*(\d+)\s*pass,\s*(\d+)\s*fail/);
  const dateMatch = md.match(/# Visual Report — (\S+ \S+)/);
  return {
    statusMap,
    total: summaryMatch ? parseInt(summaryMatch[1]) : 0,
    pass: summaryMatch ? parseInt(summaryMatch[2]) : 0,
    fail: summaryMatch ? parseInt(summaryMatch[3]) : 0,
    lastRun: dateMatch ? dateMatch[1] : 'unknown',
  };
}

// ── 3. Parse regressions ──
function parseRegressions() {
  if (!existsSync(REGRESSIONS_PATH)) return {};
  const data = yaml.load(readFileSync(REGRESSIONS_PATH, 'utf8'));
  const map = {};
  // Support both `regressions:` and `tests:` as the top-level array key
  const regs = Array.isArray(data?.regressions) ? data.regressions
              : Array.isArray(data?.tests)       ? data.tests
              : [];
  for (const r of regs) {
    if (r && r.test) map[r.test] = r;
  }
  return map;
}

// ── 4. Walk test directories ──
function collectTests() {
  const tests = [];
  for (const cat of CATEGORIES) {
    const catDir = join(ROOT, cat);
    if (!existsSync(catDir)) continue;
    walkDir(catDir, cat, tests);
  }
  return tests;
}

function walkDir(dir, category, tests) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      walkDir(join(dir, entry.name), category, tests);
    } else if (entry.name.endsWith('.yaml')) {
      try {
        const fullPath = join(dir, entry.name);
        const manifest = yaml.load(readFileSync(fullPath, 'utf8'));
        if (!manifest || manifest.deprecated) continue;
        const relPath = relative(ROOT, fullPath).replace('.yaml', '');
        tests.push(buildEntry(relPath, category, manifest));
      } catch (e) {
        console.warn(`  WARN: Failed to parse ${join(dir, entry.name)}: ${e.message}`);
      }
    }
  }
}

// Escape for safe embedding in JSON (no HTML escaping — data lives in JS, not in DOM)
function sanitize(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function buildEntry(id, category, manifest) {
  const slug = id.split('/').pop();
  return {
    id: sanitize(id),
    category: sanitize(category),
    name: sanitize(manifest.name || slug),
    description: sanitize(manifest.description || ''),
    priority: sanitize(manifest.priority || 'medium'),
    tags: (manifest.tags || []).map(sanitize),
    requiresAuth: manifest.requires_auth ?? true,
    featureFlag: manifest.feature_flag ? sanitize(manifest.feature_flag) : null,
    url: extractUrl(manifest.steps || []),
    steps: (manifest.steps || []).map(s => {
      const step = {};
      for (const k in s) { step[k] = sanitize(s[k]); }
      return step;
    }),
    screenshot: findScreenshot(id, slug, manifest.steps || []),
    screenshotBefore: findBeforeScreenshot(id, slug, manifest.steps || []),
    screenshotMtime: getScreenshotMtime(id, slug, manifest.steps || []),
    status: 'STALE',
    failureReason: null,
    fixCycles: 0, // will be set from regressions history
  };
}

function extractUrl(steps) {
  const openStep = steps.find(s => s.action === 'open' && s.url);
  if (!openStep) return '';
  return sanitize(openStep.url.replace('{base_url}', config.base_url || 'http://localhost:6969'));
}

function getScreenshotMtime(id, slug, steps) {
  const candidates = [];
  for (const s of steps) { if (s.screenshot) candidates.push(s.screenshot); }
  candidates.push(`${slug}.png`, id.replace(/\//g, '-') + '.png');
  for (const c of candidates) {
    const p = join(SCREENSHOTS_DIR, c);
    if (existsSync(p)) return statSync(p).mtimeMs;
  }
  return 0;
}

function findBeforeScreenshot(id, slug, steps) {
  const candidates = [];
  for (const s of steps) {
    if (s.screenshot) candidates.push(s.screenshot.replace('.png', '-before.png'));
  }
  candidates.push(`${slug}-before.png`, id.replace(/\//g, '-') + '-before.png');
  for (const c of candidates) {
    if (existsSync(join(SCREENSHOTS_DIR, c))) return `screenshots/${c}`;
  }
  return null;
}

function findScreenshot(id, slug, steps) {
  const candidates = [];
  // Manifest screenshot field takes priority over slug/id patterns
  for (const s of steps) {
    if (s.screenshot) candidates.push(s.screenshot);
  }
  candidates.push(`${slug}.png`);
  candidates.push(id.replace(/\//g, '-') + '.png');
  for (const c of candidates) {
    if (existsSync(join(SCREENSHOTS_DIR, c))) return `screenshots/${c}`;
  }
  return null;
}

// ── 5. Merge status from report ──
function mergeStatus(tests, report, regressions) {
  for (const t of tests) {
    const slug = t.id.split('/').pop();
    // Match by full path first, then by slug
    if (report.statusMap[t.id]) {
      t.status = report.statusMap[t.id];
    } else if (report.statusMap[slug]) {
      t.status = report.statusMap[slug];
    }
    const reg = regressions[t.id] || regressions[slug];
    if (reg) {
      t.failureReason = sanitize(reg.failure_reason || '');
      if (t.status === 'STALE') t.status = 'FAIL';
      // consecutive_passes === 0 means currently broken = at least 1 fix cycle attempted
      if (typeof reg.consecutive_passes === 'number' && reg.consecutive_passes === 0) {
        t.fixCycles = Math.max(1, t.fixCycles);
      }
    }
  }
}

// ── 6. Read HTML template ──
function getHtmlTemplate() {
  // The template is a separate file for clarity
  return readFileSync(join(ROOT, '_review-template.html'), 'utf8');
}

// ── 7. Persona-aware change reports ──
const DEFAULT_REPORT_AUDIENCES = {
  client: {
    id: 'client',
    label: 'Client validation',
    badge: 'Decision view',
    focus: 'Choose what feels right and leave clear validation comments.',
    sections: ['impact', 'choices', 'risk'],
  },
  business: {
    id: 'business',
    label: 'Business stakeholder',
    badge: 'Outcome view',
    focus: 'Understand the business outcome, tradeoffs, and remaining risk.',
    sections: ['impact', 'priority', 'risk'],
  },
  product: {
    id: 'product',
    label: 'Product',
    badge: 'Roadmap view',
    focus: 'Evaluate scope, priority, acceptance criteria, and next decisions.',
    sections: ['problem', 'impact', 'priority', 'tests'],
  },
  design: {
    id: 'design',
    label: 'Design / UX',
    badge: 'UX rationale',
    focus: 'Review before/after evidence, interaction rationale, and visual tradeoffs.',
    sections: ['problem', 'decision', 'impact', 'risk'],
  },
  engineering: {
    id: 'engineering',
    label: 'Engineering',
    badge: 'Implementation view',
    focus: 'Check files, tests, technical risks, and implementation boundaries.',
    sections: ['decision', 'tests', 'files', 'risk'],
  },
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(value) {
  return String(value || 'report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'report';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeAudience(value) {
  if (typeof value === 'string') {
    const known = DEFAULT_REPORT_AUDIENCES[value];
    return known ? { ...known } : {
      id: slugify(value),
      label: value,
      badge: 'Custom view',
      focus: 'Review the change report from this audience perspective.',
      sections: ['problem', 'decision', 'impact', 'risk'],
    };
  }
  if (value && typeof value === 'object') {
    const id = slugify(value.id || value.label || 'custom');
    const known = DEFAULT_REPORT_AUDIENCES[id] || {};
    return {
      ...known,
      ...value,
      id,
      label: value.label || known.label || id,
      badge: value.badge || known.badge || 'Custom view',
      focus: value.focus || known.focus || 'Review the change report from this audience perspective.',
      sections: asArray(value.sections || known.sections || ['problem', 'decision', 'impact', 'risk']),
    };
  }
  return null;
}

function normalizeChangeReport(id, raw) {
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid report.json for ${id}: expected object`);
  const changes = Array.isArray(raw.changes) ? raw.changes : null;
  if (!changes) throw new Error(`Invalid report.json for ${id}: changes must be an array`);
  const configuredAudiences = raw.audiences || raw.personas || ['client', 'product', 'design', 'engineering'];
  const audiences = asArray(configuredAudiences).map(normalizeAudience).filter(Boolean);
  if (audiences.length === 0) throw new Error(`Invalid report.json for ${id}: at least one audience is required`);
  return {
    id: slugify(raw.id || id),
    title: raw.title || id,
    subtitle: raw.subtitle || raw.summary || '',
    summary: raw.summary || raw.subtitle || '',
    route: raw.route || raw.url || '',
    generatedAt: raw.generated_at || raw.generatedAt || new Date().toISOString(),
    status: raw.status || 'draft',
    links: Array.isArray(raw.links) ? raw.links : [],
    audiences,
    changes: changes.map((change, index) => ({
      id: slugify(change.id || `change-${index + 1}`),
      title: change.title || `Change ${index + 1}`,
      summary: change.summary || '',
      problem: change.problem || '',
      decision: change.decision || change.solution || '',
      impact: change.impact || '',
      choices: asArray(change.choices),
      priority: change.priority || change.severity || '',
      risk: change.risk || change.residual_risk || '',
      tests: asArray(change.tests),
      files: asArray(change.files),
      tags: asArray(change.tags),
      before: normalizeShot(change.before),
      after: normalizeShot(change.after),
    })),
  };
}

function normalizeShot(value) {
  if (!value) return null;
  if (typeof value === 'string') return { src: value, caption: '' };
  if (typeof value === 'object' && value.src) {
    return {
      src: String(value.src),
      caption: value.caption || value.label || '',
      alt: value.alt || value.caption || value.label || '',
    };
  }
  return null;
}

function collectChangeReports() {
  if (!existsSync(CHANGE_REPORTS_DIR)) return [];
  const reports = [];
  for (const entry of readdirSync(CHANGE_REPORTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const reportPath = join(CHANGE_REPORTS_DIR, entry.name, 'report.json');
    if (!existsSync(reportPath)) continue;
    reports.push(normalizeChangeReport(entry.name, readJson(reportPath)));
  }
  return reports;
}

function reportAssetHref(report, src) {
  if (!src) return '';
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  const cleaned = src.replace(/^\.?\//, '');
  return `../../change-reports/${encodeURIComponent(report.id)}/${cleaned.split('/').map(encodeURIComponent).join('/')}`;
}

function renderMaybe(label, value) {
  if (!value || (Array.isArray(value) && value.length === 0)) return '';
  const body = Array.isArray(value)
    ? `<ul>${value.map(v => `<li>${escapeHtml(v)}</li>`).join('')}</ul>`
    : `<p>${escapeHtml(value)}</p>`;
  return `<div class="fact"><strong>${escapeHtml(label)}</strong>${body}</div>`;
}

function renderShot(report, label, shot) {
  if (!shot) {
    return `<div class="shot empty"><div class="shot-label"><strong>${escapeHtml(label)}</strong><span>No screenshot provided</span></div></div>`;
  }
  const href = reportAssetHref(report, shot.src);
  return `
    <a class="shot" href="${href}">
      <div class="shot-label"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(shot.caption || '')}</span></div>
      <img src="${href}" alt="${escapeHtml(shot.alt || shot.caption || label)}" loading="lazy" />
    </a>`;
}

function audienceFacts(change, audience) {
  const sections = new Set(audience.sections || []);
  const facts = [];
  if (sections.has('problem')) facts.push(renderMaybe('Problem', change.problem));
  if (sections.has('decision')) facts.push(renderMaybe('Decision', change.decision));
  if (sections.has('impact')) facts.push(renderMaybe('Expected impact', change.impact));
  if (sections.has('choices')) facts.push(renderMaybe('Choices to validate', change.choices));
  if (sections.has('priority')) facts.push(renderMaybe('Priority', change.priority));
  if (sections.has('tests')) facts.push(renderMaybe('Tests / routes', change.tests));
  if (sections.has('files')) facts.push(renderMaybe('Files', change.files));
  if (sections.has('risk')) facts.push(renderMaybe('Residual risk', change.risk));
  return facts.filter(Boolean).join('');
}

function renderAudienceReport(report, audience) {
  const title = `${report.title} - ${audience.label}`;
  const storageKey = `shipguard:persona-report:${report.id}:${audience.id}`;
  const changeCards = report.changes.map(change => `
    <article class="change" data-change="${escapeHtml(change.id)}">
      <div class="change-head">
        <div>
          <h2>${escapeHtml(change.title)}</h2>
          <p>${escapeHtml(change.summary || change.impact || change.problem || '')}</p>
        </div>
        ${change.tags.length ? `<div class="tags">${change.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="evidence">
        ${renderShot(report, 'Before', change.before)}
        ${renderShot(report, 'After', change.after)}
      </div>
      <div class="facts">${audienceFacts(change, audience)}</div>
      <div class="review">
        <textarea data-note placeholder="Comment for ${escapeHtml(audience.label)}..."></textarea>
        <div class="decision-row">
          <label><input type="radio" name="${escapeHtml(change.id)}" value="accept" /> Accept</label>
          <label><input type="radio" name="${escapeHtml(change.id)}" value="adjust" /> Adjust</label>
          <label><input type="radio" name="${escapeHtml(change.id)}" value="reject" /> Reject</label>
        </div>
      </div>
    </article>`).join('');

  const links = report.links.map(link => {
    if (!link || !link.href) return '';
    return `<a class="button" href="${escapeHtml(link.href)}">${escapeHtml(link.label || link.href)}</a>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#edf2f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}a{color:inherit}.hero{padding:28px min(5vw,56px);background:linear-gradient(180deg,#121a2b,#0b1020);border-bottom:1px solid #263247}.brand{color:#79b8ff;font-size:13px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.pill{display:inline-flex;border:1px solid #315078;border-radius:999px;color:#cfe2ff;background:#162b45;font-size:12px;font-weight:750;padding:5px 9px;margin-left:8px}h1{font-size:clamp(28px,4vw,46px);line-height:1.08;margin:14px 0 8px}h2,h3,p{margin:0}.subtitle{color:#a6b2c2;font-size:15px;max-width:940px}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:20px}.metric,.note,.change{background:#151e30;border:1px solid #2b374c;border-radius:8px}.metric{padding:13px 14px}.metric strong{display:block;font-size:24px}.metric span,.note p,.change-head p,.fact p,.fact li,.shot-label span,.footer{color:#a6b2c2}main{padding:24px min(5vw,56px) 56px}.note{padding:16px;margin-bottom:18px}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.button,button{background:#0f1726;border:1px solid #2b374c;border-radius:6px;color:#edf2f7;cursor:pointer;display:inline-flex;font:inherit;font-size:13px;font-weight:750;padding:8px 10px;text-decoration:none}.changes{display:grid;gap:18px}.change{overflow:hidden}.change-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid #2b374c;padding:16px}.tags{display:flex;gap:6px;flex-wrap:wrap}.tags span{background:#22314a;border:1px solid #344763;border-radius:999px;color:#b9c8dc;font-size:12px;padding:4px 8px}.evidence{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.shot{border-right:1px solid #2b374c;min-width:0}.shot:last-child{border-right:0}.shot-label{display:flex;justify-content:space-between;gap:10px;background:#1d2940;border-bottom:1px solid #2b374c;padding:10px 12px}.shot img{display:block;width:100%;height:auto;background:#0f1726}.shot.empty{min-height:180px;background:#0f1726}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;border-top:1px solid #2b374c;padding:14px 16px}.fact strong{display:block;font-size:12px;text-transform:uppercase;margin-bottom:4px}.fact ul{margin:0;padding-left:18px}.review{border-top:1px solid #2b374c;padding:14px 16px 16px}textarea{display:block;width:100%;min-height:86px;resize:vertical;background:#0f1726;border:1px solid #2b374c;border-radius:6px;color:#edf2f7;font:inherit;font-size:13px;padding:10px}textarea:focus{outline:none;border-color:#79b8ff}.decision-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;color:#a6b2c2}.decision-row input{accent-color:#79b8ff}.footer{font-size:12px;margin-top:24px}@media(max-width:860px){.evidence{grid-template-columns:1fr}.shot{border-right:0;border-bottom:1px solid #2b374c}.shot:last-child{border-bottom:0}}
</style>
</head>
<body>
<header class="hero">
  <div><span class="brand">ShipGuard</span><span class="pill">${escapeHtml(audience.badge)}</span></div>
  <h1>${escapeHtml(title)}</h1>
  <p class="subtitle">${escapeHtml(audience.focus)}</p>
  <div class="meta">
    <div class="metric"><strong>${report.changes.length}</strong><span>changes to review</span></div>
    <div class="metric"><strong>${escapeHtml(report.status)}</strong><span>report status</span></div>
    <div class="metric"><strong>${escapeHtml(report.route || 'n/a')}</strong><span>route / flow</span></div>
    <div class="metric"><strong>${escapeHtml(new Date(report.generatedAt).toISOString().slice(0, 10))}</strong><span>generated</span></div>
  </div>
</header>
<main>
  <section class="note">
    <h2>Report context</h2>
    <p>${escapeHtml(report.summary || report.subtitle || 'No summary provided.')}</p>
    <div class="toolbar">
      <a class="button" href="index.html">All audiences</a>
      <button id="export-comments" type="button">Export comments JSON</button>
      <button id="clear-comments" type="button">Clear local comments</button>
      ${links}
    </div>
  </section>
  <section class="changes">${changeCards}</section>
  <p class="footer">Generated by ShipGuard Persona Reports. Comments are stored locally in this browser and can be exported as JSON.</p>
</main>
<script>
(function(){
  var storageKey=${JSON.stringify(storageKey)};
  var changes=Array.prototype.slice.call(document.querySelectorAll('[data-change]'));
  function readState(){try{return JSON.parse(localStorage.getItem(storageKey)||'{}')}catch(_){return {}}}
  function writeState(state){localStorage.setItem(storageKey,JSON.stringify(state))}
  function collect(){var state={};changes.forEach(function(node){var id=node.getAttribute('data-change');var checked=node.querySelector('input[type=radio]:checked');state[id]={note:node.querySelector('[data-note]').value,decision:checked?checked.value:null}});return state}
  function restore(){var state=readState();changes.forEach(function(node){var id=node.getAttribute('data-change');var data=state[id]||{};node.querySelector('[data-note]').value=data.note||'';if(data.decision){var input=node.querySelector("input[value='"+data.decision+"']");if(input)input.checked=true}})}
  changes.forEach(function(node){node.addEventListener('input',function(){writeState(collect())});node.addEventListener('change',function(){writeState(collect())})});
  document.getElementById('export-comments').addEventListener('click',function(){var payload={report:${JSON.stringify(report.id)},audience:${JSON.stringify(audience.id)},exported_at:new Date().toISOString(),comments:collect()};var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});var url=URL.createObjectURL(blob);var link=document.createElement('a');link.href=url;link.download=${JSON.stringify(`${report.id}-${audience.id}-review.json`)};document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url)});
  document.getElementById('clear-comments').addEventListener('click',function(){localStorage.removeItem(storageKey);changes.forEach(function(node){node.querySelector('[data-note]').value='';Array.prototype.forEach.call(node.querySelectorAll('input[type=radio]'),function(input){input.checked=false})})});
  restore();
}());
</script>
</body>
</html>`;
}

function renderAudienceIndex(report) {
  const links = report.audiences.map(audience => `
    <a class="audience" href="${encodeURIComponent(audience.id)}.html">
      <strong>${escapeHtml(audience.label)}</strong>
      <span>${escapeHtml(audience.focus)}</span>
    </a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(report.title)} - ShipGuard audiences</title><style>body{margin:0;background:#0b1020;color:#edf2f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:32px min(5vw,56px)}h1{font-size:clamp(28px,4vw,44px);margin:0 0 10px}.muted{color:#a6b2c2;max-width:860px;line-height:1.5}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:24px}.audience{display:block;background:#151e30;border:1px solid #2b374c;border-radius:8px;color:inherit;padding:16px;text-decoration:none}.audience:hover{border-color:#79b8ff}.audience strong{display:block;margin-bottom:6px}.audience span{color:#a6b2c2;font-size:14px;line-height:1.45}</style></head><body><main><h1>${escapeHtml(report.title)}</h1><p class="muted">${escapeHtml(report.summary || 'Choose the audience-specific view to review this change report.')}</p><div class="grid">${links}</div></main></body></html>`;
}

function renderReportsIndex(generated) {
  const links = generated.map(item => `<a class="report" href="${encodeURIComponent(item.id)}/index.html"><strong>${escapeHtml(item.title)}</strong><span>${item.audiences} audience views</span></a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>ShipGuard Persona Reports</title><style>body{margin:0;background:#0b1020;color:#edf2f7;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:32px min(5vw,56px)}h1{font-size:clamp(28px,4vw,44px);margin:0 0 10px}.muted{color:#a6b2c2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-top:24px}.report{display:block;background:#151e30;border:1px solid #2b374c;border-radius:8px;color:inherit;padding:16px;text-decoration:none}.report:hover{border-color:#79b8ff}.report strong{display:block;margin-bottom:6px}.report span{color:#a6b2c2;font-size:14px}</style></head><body><main><h1>ShipGuard Persona Reports</h1><p class="muted">Audience-specific reports generated from change-report specs.</p><div class="grid">${links || '<p class="muted">No reports generated.</p>'}</div></main></body></html>`;
}

function generatePersonaReports() {
  const reports = collectChangeReports();
  if (reports.length === 0) return 0;
  mkdirSync(PERSONA_REPORTS_DIR, { recursive: true });
  const generated = [];
  for (const report of reports) {
    const outDir = join(PERSONA_REPORTS_DIR, report.id);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'index.html'), renderAudienceIndex(report), 'utf8');
    for (const audience of report.audiences) {
      writeFileSync(join(outDir, `${audience.id}.html`), renderAudienceReport(report, audience), 'utf8');
    }
    generated.push({ id: report.id, title: report.title, audiences: report.audiences.length });
  }
  writeFileSync(join(PERSONA_REPORTS_DIR, 'index.html'), renderReportsIndex(generated), 'utf8');
  return generated.reduce((sum, item) => sum + item.audiences + 1, 1);
}

// ── Main ──
console.log('Building Visual review page...');

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

const report = parseReport();
const regressions = parseRegressions();
const tests = collectTests();

console.log(`  Found ${tests.length} test manifests`);

mergeStatus(tests, report, regressions);

const passCount = tests.filter(t => t.status === 'PASS').length;
const failCount = tests.filter(t => t.status === 'FAIL').length;
const staleCount = tests.filter(t => t.status === 'STALE').length;

const data = {
  generated: new Date().toISOString(),
  summary: {
    total: tests.length,
    pass: passCount,
    fail: failCount,
    stale: staleCount,
    passRate: tests.length > 0 ? (passCount / tests.length) * 100 : 0,
    lastRun: report.lastRun || new Date().toISOString().split('T')[0],
  },
  categories: CATEGORIES.filter(c => tests.some(t => t.category === c)),
  tests,
  // Track last fix-manifest timestamp to detect "updated" screenshots
  lastFixTimestamp: existsSync(join(RESULTS_DIR, 'fix-manifest.json'))
    ? statSync(join(RESULTS_DIR, 'fix-manifest.json')).mtimeMs : 0,
};

console.log(`  Status: ${passCount} pass, ${failCount} fail, ${staleCount} stale`);
console.log(`  Screenshots matched: ${tests.filter(t => t.screenshot).length}/${tests.length}`);

// ── Collect recorded manifests ──
const MANIFESTS_DIR = join(ROOT, 'manifests');
const recordedTests = [];
if (existsSync(MANIFESTS_DIR)) {
  for (const file of readdirSync(MANIFESTS_DIR).filter(f => f.endsWith('.yaml'))) {
    try {
      const text = readFileSync(join(MANIFESTS_DIR, file), 'utf8');
      const manifest = yamlParse(text);
      if (!manifest.name) continue;
      const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
      const stepCount = steps.filter(s => s.action !== 'screenshot').length;
      const checkCount = steps.filter(s => s.action === 'assert_text' || s.action === 'llm-check').length;
      const openStep = steps.find(s => s.action === 'open');
      const testUrl = openStep ? (openStep.url || '').replace('{base_url}', '') : '';
      const slug = file.replace('.yaml', '');
      recordedTests.push({
        id: 'recorded/' + slug,
        file,
        name: manifest.name,
        description: manifest.description || '',
        source: manifest.source || 'recorded',
        recordedAt: manifest.recorded_at || null,
        stepCount,
        checkCount,
        url: testUrl,
        status: null,
        summary: steps
          .filter(s => ['open', 'click', 'fill', 'assert_text', 'llm-check', 'upload'].includes(s.action))
          .slice(0, 5)
          .map(s => s.action + ': ' + (s.target || s.text || s.url || '').slice(0, 40))
          .join(' \u2192 '),
      });
    } catch (e) {
      console.warn('  Warning: could not parse ' + file + ': ' + e.message);
    }
  }
  console.log('  Found ' + recordedTests.length + ' recorded manifests');
}

const template = getHtmlTemplate();
const html = template
  .replace('"__PLACEHOLDER_VISUAL_DATA__"', JSON.stringify(data))
  .replace('"__PLACEHOLDER_RECORDED_DATA__"', JSON.stringify(recordedTests));
writeFileSync(OUTPUT_PATH, html, 'utf8');

console.log(`  Output: ${OUTPUT_PATH}`);

// ── Generate thumbnails (macOS sips, no dependency) ──
const THUMBS_DIR = join(RESULTS_DIR, 'thumbs');
if (!process.argv.includes('--stop')) {
  mkdirSync(THUMBS_DIR, { recursive: true });
  let thumbCount = 0;
  for (const t of tests) {
    if (!t.screenshot) continue;
    const src = join(RESULTS_DIR, t.screenshot);
    const thumbName = t.screenshot.replace('screenshots/', '');
    const dest = join(THUMBS_DIR, thumbName);
    if (!existsSync(src)) continue;
    if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) { thumbCount++; continue; }
    try {
      // macOS: sips (built-in). Linux: convert (ImageMagick) or cp as fallback.
      if (process.platform === 'darwin') {
        execFileSync('sips', ['-Z', '400', src, '--out', dest], { stdio: 'pipe' });
      } else {
        try {
          execFileSync('convert', [src, '-resize', '400x>', dest], { stdio: 'pipe' });
        } catch {
          execFileSync('cp', [src, dest], { stdio: 'pipe' }); // no resize, just copy
        }
      }
      thumbCount++;
    } catch { /* thumbnail generation failed — grid uses full images */ }
  }
  console.log(`  Thumbnails: ${thumbCount}/${tests.filter(t => t.screenshot).length}`);
}

const personaReportCount = generatePersonaReports();
if (personaReportCount > 0) {
  console.log(`  Persona reports: ${personaReportCount} pages`);
}

// ── Server PID file ──
const PID_FILE = join(RESULTS_DIR, '.server.pid');

// --stop: kill existing server
if (process.argv.includes('--stop')) {
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (isNaN(pid)) { console.error('Invalid PID file'); process.exit(1); }
    try { process.kill(pid); } catch { /* already dead */ }
    writeFileSync(PID_FILE, '', 'utf8');
    console.log(`Server stopped (PID ${pid}).`);
  } else {
    console.log('No server running.');
  }
  process.exit(0);
}

// --serve: start HTTP server with PID file
if (process.argv.includes('--serve')) {
  if (existsSync(PID_FILE)) {
    const oldPid = readFileSync(PID_FILE, 'utf8').trim();
    if (oldPid) try { process.kill(parseInt(oldPid)); } catch { /* already dead */ }
  }

  const http = await import('http');
  const { createReadStream, existsSync: fExists } = await import('fs');
  const { extname } = await import('path');

  const MIME = { '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.js': 'text/javascript' };
  const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '8888');

  // ── Monitor state (in-memory + persisted to JSON) ──
  let auditState = null;
  const MONITOR_PATH = join(RESULTS_DIR, 'audit-monitor.json');

  function persistMonitor() {
    if (auditState) writeFileSync(MONITOR_PATH, JSON.stringify(auditState, null, 2), 'utf8');
  }

  function readBody(req, maxBytes = 5 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { req.destroy(); reject(new Error('Payload too large')); return; }
        body += chunk;
      });
      req.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  // Wildcard CORS: intentional — server is localhost-only, not exposed to network
  const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' };

  const server = http.createServer(async (req, res) => {
    // ── GET /health ──
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify({ status: 'ok', results_dir: RESULTS_DIR, audit_active: !!auditState }));
      return;
    }

    // ── POST /api/monitor/audit-start ──
    if (req.method === 'POST' && req.url === '/api/monitor/audit-start') {
      try {
        const data = await readBody(req);
        auditState = {
          ...data,
          agents: {},
          status: 'running',
          started_at: data.timestamp || new Date().toISOString(),
        };
        // Pre-populate agents from zones
        for (const z of (data.zones || [])) {
          auditState.agents[`r1:${z.zone_id || z.id}`] = {
            zone_id: z.zone_id || z.id,
            status: 'pending',
            paths: z.paths,
            file_count: z.file_count,
          };
        }
        persistMonitor();
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── POST /api/monitor/agent-update ──
    if (req.method === 'POST' && req.url === '/api/monitor/agent-update') {
      try {
        const data = await readBody(req);
        if (!auditState) {
          auditState = { agents: {}, status: 'running', started_at: new Date().toISOString() };
        }
        const id = data.agent_id || data.zone_id;
        auditState.agents[id] = { ...(auditState.agents[id] || {}), ...data };
        persistMonitor();
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── POST /api/monitor/audit-complete ──
    if (req.method === 'POST' && req.url === '/api/monitor/audit-complete') {
      try {
        const data = await readBody(req);
        if (auditState) {
          auditState.status = 'completed';
          auditState.completed_at = data.timestamp || new Date().toISOString();
        }
        persistMonitor();
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    // ── GET /api/monitor/status ──
    if (req.method === 'GET' && req.url === '/api/monitor/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
      res.end(JSON.stringify(auditState || { status: 'idle' }));
      return;
    }

    // POST /save-manifest — save fix manifest from review page
    if (req.method === 'POST' && req.url === '/save-manifest') {
      const MAX_BODY = 5 * 1024 * 1024; // 5 MB
      let body = '';
      let bodySize = 0;
      req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY) {
          // r1-z02-012: send response BEFORE destroying — headers must be sent first
          res.writeHead(413, { 'Content-Type': 'application/json', ...CORS });
          res.end(JSON.stringify({ error: 'Payload too large (max 5 MB)' }));
          req.destroy();
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const manifestPath = join(RESULTS_DIR, 'fix-manifest.json');
          writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ok: true, path: manifestPath }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      res.end();
      return;
    }
    const url = req.url === '/' ? '/review.html' : req.url;
    const filePath = join(RESULTS_DIR, url.replace(/^\//, ''));
    // BUG-4: Prevent path traversal attacks
    if (!filePath.startsWith(RESULTS_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fExists(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = extname(filePath);
    const noCache = { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...noCache });
    createReadStream(filePath).pipe(res);
  });

  server.listen(PORT, () => {
    writeFileSync(PID_FILE, String(process.pid), 'utf8');
    console.log(`  Server: http://localhost:${PORT} (PID ${process.pid})`);
    console.log('  Stop: node visual-tests/build-review.mjs --stop');
  });
} else {
  console.log('  Tip: --serve to start, --stop to stop');
  console.log('Done.');
}
