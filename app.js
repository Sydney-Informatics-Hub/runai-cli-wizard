'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// app.js — UI, persistence, and bootstrap
//
// Depends on: parser.js, workloads.js
// Load order in index.html: parser.js → workloads.js → app.js
// ══════════════════════════════════════════════════════════════════════════════

// ── Utilities ─────────────────────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getField(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}


// ── Parse preview ──────────────────────────────────────────────────────────

/**
 * Populate the <details id="…-preview"> element with a summary of what
 * was parsed from the docker run command.
 * Called from workloads.js generate() at render time.
 */
function renderPreview(el, p, jobnameOverride, resolvedFramework, wasAuto) {
  if (!p.image) { el.style.display = 'none'; return; }
  const jobname  = jobnameOverride.trim() || imageToJobName(p.image);
  const fwOption = FRAMEWORK_OPTIONS.find(o => o.value === resolvedFramework) || FRAMEWORK_OPTIONS[0];
  el.style.display = '';
  el.innerHTML = `
    <summary>
      <code>${esc(jobname)}</code> &nbsp;·&nbsp; port <code>${p.ports[0] || '7860'}</code>
      &nbsp;·&nbsp; ${fwOption.label}${wasAuto ? ' <small>(auto-detected)</small>' : ''}
    </summary>
    <dl>
      <dt>Image</dt>    <dd><code>${esc(p.image)}</code></dd>
      <dt>Job name</dt> <dd>${esc(jobname)}</dd>
      <dt>Port</dt>     <dd>${p.ports[0] || '7860 (default)'}</dd>
      <dt>Framework</dt><dd>${fwOption.label}${wasAuto ? ' — auto-detected' : ''}</dd>
      ${p.command.length ? `<dt>Command</dt><dd><code>${esc(p.command.join(' '))}</code></dd>` : ''}
    </dl>`;
}


// ── Copy button SVGs ───────────────────────────────────────────────────────

const SVG_CLIPBOARD = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
  stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"></path>
  <path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"></path>
</svg>`;

const SVG_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
  stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 12l5 5l10 -10"></path>
</svg>`;


// ── Output rendering ───────────────────────────────────────────────────────

function renderOutput() {
  const raw    = document.getElementById('project-code').value.trim();
  const outEl  = document.getElementById('cmd-out');
  const copyEl = document.getElementById('copy-btn');
  const wl     = WORKLOADS.find(w => w.id === activeId);

  if (!raw) {
    outEl.innerHTML = '<span class="comment"># Enter your DaSHR project code above.</span>';
    setCopyEnabled(false);
    return;
  }

  let result;
  try { result = wl.generate.call(wl, raw, getField); }
  catch (e) { result = null; }

  const isError = !result || result.startsWith('#');
  outEl.innerHTML = isError
    ? `<span class="comment">${esc(result || '# Fill in the fields above.')}</span>`
    : esc(result).replace(/ \\$/gm, ' <span class="dim">\\</span>');
  setCopyEnabled(!isError);
}

function setCopyEnabled(enabled) {
  const el = document.getElementById('copy-btn');
  el.style.pointerEvents = enabled ? '' : 'none';
  el.style.opacity = enabled ? '0.6' : '0.15';
}


// ── Nav and panels ─────────────────────────────────────────────────────────

let activeId = WORKLOADS[0].id;

function buildNav() {
  const ul = document.getElementById('tab-bar');
  WORKLOADS.forEach((wl, idx) => {
    const li = document.createElement('li');
    const a  = document.createElement('a');
    a.href        = '#';
    a.textContent = wl.name;
    a.dataset.id  = wl.id;
    if (idx === 0) a.setAttribute('aria-current', 'page');
    a.addEventListener('click', e => {
      e.preventDefault();
      activeId = wl.id;
      document.querySelectorAll('#tab-bar a').forEach(b =>
        b.dataset.id === wl.id
          ? b.setAttribute('aria-current', 'page')
          : b.removeAttribute('aria-current')
      );
      document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `panel-${wl.id}`)
      );
      save();
      renderOutput();
    });
    li.appendChild(a);
    ul.appendChild(li);
  });
}

function buildPanels() {
  const container = document.getElementById('panels');
  WORKLOADS.forEach((wl, idx) => {
    const panel = document.createElement('div');
    panel.id        = `panel-${wl.id}`;
    panel.className = 'tab-panel' + (idx === 0 ? ' active' : '');
    panel.innerHTML = `<p><small>${wl.desc}</small></p>` + wl.fields.call(wl);
    container.appendChild(panel);
  });
}


// ── Project derived text ───────────────────────────────────────────────────

function updateDerived() {
  const raw = document.getElementById('project-code').value.trim();
  const el  = document.getElementById('project-derived');
  if (!raw) { el.textContent = ''; return; }
  el.textContent = `-p ${lower(raw)}  ·  ${vclaim(raw)}`;
}


// ── Persistence ────────────────────────────────────────────────────────────

function save() {
  try {
    localStorage.setItem('runai-gen-project', document.getElementById('project-code').value);
    localStorage.setItem('runai-gen-active',  activeId);
    const state = {};
    WORKLOADS.forEach(wl => {
      state[wl.id] = {};
      document.querySelectorAll(`#panel-${wl.id} input, #panel-${wl.id} select, #panel-${wl.id} textarea`)
        .forEach(el => { if (el.id) state[wl.id][el.id] = el.value; });
    });
    localStorage.setItem('runai-gen-fields', JSON.stringify(state));
  } catch (_) {}
}

function restore() {
  try {
    const proj = localStorage.getItem('runai-gen-project');
    if (proj) document.getElementById('project-code').value = proj;

    const aid = localStorage.getItem('runai-gen-active');
    if (aid && WORKLOADS.find(w => w.id === aid)) {
      activeId = aid;
      document.querySelectorAll('#tab-bar a').forEach(b =>
        b.dataset.id === aid ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')
      );
      document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `panel-${aid}`)
      );
    }

    const savedFields = localStorage.getItem('runai-gen-fields');
    if (savedFields) {
      const state = JSON.parse(savedFields);
      Object.values(state).forEach(fields =>
        Object.entries(fields).forEach(([elId, val]) => {
          const el = document.getElementById(elId);
          if (el) el.value = val;
        })
      );
    }
  } catch (_) {}
}


// ── Top-level section nav ──────────────────────────────────────────────────

function buildSectionNav() {
  const SECTION_KEY = 'runai-gen-section';
  const links    = document.querySelectorAll('nav a[data-section]');
  const sections = document.querySelectorAll('.section-panel');

  function activateSection(id, persist) {
    links.forEach(a => {
      a.dataset.section === id
        ? a.setAttribute('aria-current', 'page')
        : a.removeAttribute('aria-current');
    });
    sections.forEach(s => {
      s.classList.toggle('active', s.id === `section-${id}`);
    });
    if (persist) { try { localStorage.setItem(SECTION_KEY, id); } catch (_) {} }
  }

  links.forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      activateSection(a.dataset.section, true);
    });
  });

  // Restore last-viewed section
  try {
    const saved = localStorage.getItem(SECTION_KEY);
    if (saved && document.getElementById(`section-${saved}`)) activateSection(saved, false);
  } catch (_) {}
}


// ── Bootstrap ──────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  buildSectionNav();
  buildNav();
  buildPanels();
  restore();
  updateDerived();
  renderOutput();

  document.getElementById('project-code').addEventListener('input', () => {
    updateDerived();
    save();
    renderOutput();
  });

  // Any form change in any panel
  document.getElementById('panels').addEventListener('input', e => {
    // Auto-populate env vars when the docker command changes
    if (e.target.id === 'hf-spaces-docker') {
      const parsed = parseDockerRun(e.target.value);
      if (parsed.envVars.length) autoPopulateEnvVars('hf-spaces', parsed.envVars);
    }
    save();
    renderOutput();
  });
});


// ── Copy command ───────────────────────────────────────────────────────────

function copyCmd() {
  const text = document.getElementById('cmd-out').innerText;
  if (!text || text.trim().startsWith('#')) return;
  const btn = document.getElementById('copy-btn');
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = SVG_CHECK;
    btn.setAttribute('data-tooltip', 'Copied!');
    btn.style.opacity = '1';
    setTimeout(() => {
      btn.innerHTML = SVG_CLIPBOARD;
      btn.setAttribute('data-tooltip', 'Copy to clipboard');
      btn.style.opacity = '0.6';
    }, 2000);
  }).catch(() => {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}
