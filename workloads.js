'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// workloads.js — GPU options, framework options, and the workload registry
//
// Depends on: parser.js (parseDockerRun, imageToJobName, parseEnvLines,
//                        autoPopulateEnvVars, resetEnvVars)
// ══════════════════════════════════════════════════════════════════════════════

// ── Project/command helpers ────────────────────────────────────────────────

const lower  = p => p.toLowerCase();
const vclaim = p => `pvc-${lower(p)}`;

/** Join a flat array of runai args with shell line-continuation formatting */
function cmd(...args) {
  return args.flat().filter(s => s !== '' && s != null).join(' \\\n  ');
}


// ── GPU options ────────────────────────────────────────────────────────────
// To add a new option, append an entry to this array.
// flags: the runai CLI flags that will be inserted into the command.

const GPU_OPTIONS = [
  { value: 'none',        label: 'None (CPU only)',                         flags: [] },
  { value: 'portion-0.2', label: '0.2 GPU  (--gpu-portion-request 0.2)',    flags: ['--gpu-portion-request 0.2'] },
  { value: 'portion-0.5', label: '0.5 GPU  (--gpu-portion-request 0.5)',    flags: ['--gpu-portion-request 0.5'] },
  { value: 'devices-1',   label: '1 GPU device  (--gpu-devices-request 1)', flags: ['--gpu-devices-request 1'] },
  { value: 'devices-2',   label: '2 GPU devices (--gpu-devices-request 2)', flags: ['--gpu-devices-request 2'] },
  { value: 'devices-4',   label: '4 GPU devices (--gpu-devices-request 4)', flags: ['--gpu-devices-request 4'] },
];

function gpuFlag(val) {
  return (GPU_OPTIONS.find(o => o.value === val) || GPU_OPTIONS[0]).flags;
}

function gpuSelect(id, defaultVal, hint) {
  const opts = GPU_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value === defaultVal ? ' selected' : ''}>${o.label}</option>`
  ).join('');
  return `<label>GPU allocation<select id="${id}">${opts}</select>${hint ? `<small>${hint}</small>` : ''}</label>`;
}


// ── Framework options ──────────────────────────────────────────────────────
// envVars: the env vars injected into the command for reverse-proxy URL routing.
// These are merged with the user's env vars textarea; user entries for the same
// KEY always win.
//
// To add a new framework: append an entry with its routing env vars.
// To fill in OpenWebUI or RStudio: add their vars to the envVars arrays below.

const FRAMEWORK_OPTIONS = [
  { value: 'auto',
    label: 'Auto-detect' },

  { value: 'gradio',
    label: 'Gradio',
    envVars: ['GRADIO_ROOT_PATH="/${RUNAI_PROJECT}/${RUNAI_JOB_NAME}"'] },

  { value: 'streamlit',
    label: 'Streamlit',
    envVars: ['STREAMLIT_SERVER_BASE_URL_PATH="/${RUNAI_PROJECT}/${RUNAI_JOB_NAME}"'] },

  { value: 'marimo',
    label: 'Marimo',
    envVars: [
      'URL="/${RUNAI_PROJECT}/${RUNAI_JOB_NAME}"',
      'HOME="/scratch/${RUNAI_PROJECT}"',
      'PROXY="https://gpu.sydney.edu.au"',
      String.raw`BASHRC='export PS1="uid$(id -u)@\h:\w$"'`,
    ] },

  { value: 'openwebui',
    label: 'Open WebUI',
    envVars: [ /* add routing vars here when known */ ] },

  { value: 'rstudio',
    label: 'RStudio',
    envVars: [ /* add routing vars here when known */ ] },

  { value: 'other',
    label: 'Other / none',
    envVars: [] },
];

function frameworkEnvVars(val) {
  return (FRAMEWORK_OPTIONS.find(o => o.value === val) || FRAMEWORK_OPTIONS[0]).envVars || [];
}

function frameworkSelect(id, defaultVal) {
  const opts = FRAMEWORK_OPTIONS.map(o =>
    `<option value="${o.value}"${o.value === defaultVal ? ' selected' : ''}>${o.label}</option>`
  ).join('');
  return `<label>Framework<select id="${id}">${opts}</select>
    <small>Sets the URL routing env var for RunAI's reverse proxy.</small></label>`;
}

/** Detect framework from a parsed docker run result */
function detectFramework(parsed) {
  const img     = (parsed.image   || '').toLowerCase();
  const command = (parsed.command || []).join(' ').toLowerCase();
  if (command.includes('streamlit'))                               return 'streamlit';
  if (command.includes('marimo'))                                  return 'marimo';
  if (img.includes('open-webui') || img.includes('openwebui'))    return 'openwebui';
  if (img.includes('rstudio'))                                     return 'rstudio';
  return 'gradio'; // default for HF Spaces / python app.py
}

/** Merge user env vars with framework env vars.
 *  User-supplied entries for a given KEY always take precedence. */
function mergeEnvVars(userLines, frameworkLines) {
  const userKeys = new Set(userLines.map(l => l.split('=')[0]));
  const extra    = frameworkLines.filter(l => !userKeys.has(l.split('=')[0]));
  return [...userLines, ...extra];
}


// ══════════════════════════════════════════════════════════════════════════════
// WORKLOAD REGISTRY
//
// To add a new workload type, append an entry to WORKLOADS below.
//
// Each entry must provide:
//   id        {string}   Unique kebab-case identifier.
//   name      {string}   Label shown on the nav tab.
//   desc      {string}   One-line description shown above the form.
//   fields()  {fn}       Returns HTML string for workload-specific fields.
//                        All form element ids must be prefixed with `${this.id}-`.
//   generate(project, f) Returns the command string, or null for a placeholder.
//                        f(id) fetches a form field's current value by element id.
// ══════════════════════════════════════════════════════════════════════════════

const WORKLOADS = [

  // ── Copyparty ──────────────────────────────────────────────────────────────
  {
    id:   'copyparty',
    name: 'Copyparty',
    desc: 'Web-based file server backed by your project\'s persistent volume. CPU-only.',

    fields() { return `
      <label>Job name
        <input type="text" id="${this.id}-jobname" value="copyparty" spellcheck="false">
      </label>
    `; },

    generate(project, f) {
      const jobname = f(`${this.id}-jobname`).trim() || 'copyparty';
      return cmd(
        `runai workspace submit ${jobname}`,
        `-p ${lower(project)}`,
        `-i copyparty/ac`,
        `--existing-pvc claimname=${vclaim(project)},path=/w`,
        `--external-url container=3923,authgroups=${project}`,
        `-- --chdir /tmp -v /w:/:A --rp-loc '/\${RUNAI_PROJECT}/\${RUNAI_JOB_NAME}'`,
      );
    },
  },

  // ── HuggingFace Spaces ─────────────────────────────────────────────────────
  {
    id:   'hf-spaces',
    name: 'HuggingFace Spaces',
    desc: 'Convert a <a href="https://huggingface.co/spaces" target="_blank" rel="noopener">HuggingFace Spaces</a> "Run locally" docker command into a RunAI workspace.',

    fields() { return `
      <label>Docker run command
        <textarea id="${this.id}-docker" rows="5" spellcheck="false"
          placeholder="docker run -it -p 7860:7860 --platform=linux/amd64 --gpus all \&#10;    -e HF_TOKEN=&quot;hf_…&quot; \&#10;    registry.hf.space/yourname-yourspace:latest python app.py"></textarea>
      </label>

      <details>
        <summary>How to get this command from HuggingFace</summary>
        <div class="grid">
          <figure>
            <img src="Run_locally_instructions_1_2.png"
                 alt="Step 1: click the ⋯ menu; Step 2: click Run locally"
                 style="width:100%;border-radius:var(--pico-border-radius)">
            <figcaption><small>① Click the <kbd>⋯</kbd> menu &nbsp; ② Click <em>Run locally</em></small></figcaption>
          </figure>
          <figure>
            <img src="Run_locally_instructions_3.png"
                 alt="Step 3: copy the docker run command"
                 style="width:100%;border-radius:var(--pico-border-radius)">
            <figcaption><small>③ Copy the docker run command</small></figcaption>
          </figure>
        </div>
      </details>

      <details id="${this.id}-preview" style="display:none">
        <summary></summary>
      </details>

      <label>Environment variables
        <textarea id="${this.id}-envvars" rows="3" spellcheck="false"
          placeholder="HF_TOKEN=hf_yourtoken&#10;ANOTHER_VAR=value&#10;# lines starting with # are ignored"></textarea>
        <small>
          Auto-populated from the docker command — edit values here (e.g. replace
          <code>YOUR_VALUE_HERE</code> with your actual token). One <code>KEY=VALUE</code> per line.
          Framework routing vars are merged in automatically; your values win on conflicts.
        </small>
      </label>

      <details>
        <summary><small>How to get a HuggingFace token</small></summary>
        <p>
          Log in to <a href="https://huggingface.co" target="_blank" rel="noopener">huggingface.co</a>,
          then follow these steps:
        </p>
        <div class="grid">
          <figure>
            <img src="token_1_2.png"
                 alt="Step 1: click your profile avatar top-right; Step 2: click Access Tokens in the menu"
                 style="width:100%;border-radius:var(--pico-border-radius)">
            <figcaption><small>① Click your profile avatar &nbsp; ② Click <em>Access Tokens</em></small></figcaption>
          </figure>
          <figure>
            <img src="token_3.png"
                 alt="Step 3: click + Create new token on the Access Tokens page"
                 style="width:100%;border-radius:var(--pico-border-radius)">
            <figcaption><small>③ Click <em>+ Create new token</em></small></figcaption>
          </figure>
        </div>
        <div class="grid">
          <figure>
            <img src="token_4.png"
                 alt="Step 4: choose Fine-grained, give the token a name, and set the permissions you need"
                 style="width:100%;border-radius:var(--pico-border-radius)">
            <figcaption><small>④ Choose <em>Fine-grained</em>, name the token, set permissions</small></figcaption>
          </figure>
          <figure>
            <img src="token_5.png"
                 alt="Step 5: copy the token value — you won't be able to see it again after closing this dialog"
                 style="width:100%;border-radius:var(--pico-border-radius)">
            <figcaption><small>⑤ Copy the token — you won't see it again after closing</small></figcaption>
          </figure>
        </div>
      </details>

      <button class="outline secondary" type="button"
              style="width:auto;margin-bottom:var(--pico-spacing)"
              onclick="resetEnvVars('${this.id}')">↺ Reset env vars from docker</button>

      <div class="grid">
        <label>Job name
          <input type="text" id="${this.id}-jobname" spellcheck="false"
                 placeholder="(auto-detected from image)">
          <small>Leave blank to use the auto-detected name.</small>
        </label>
        ${gpuSelect(`${this.id}-gpu`, 'devices-1')}
        ${frameworkSelect(`${this.id}-framework`, 'auto')}
      </div>
    `; },

    generate(project, f) {
      const rawDocker = f(`${this.id}-docker`).trim();
      if (!rawDocker) return null;

      const p = parseDockerRun(rawDocker);

      const fwVal     = f(`${this.id}-framework`);
      const resolved  = fwVal === 'auto' ? detectFramework(p) : fwVal;
      const fwEnvVars = frameworkEnvVars(resolved);

      const prevEl = document.getElementById(`${this.id}-preview`);
      if (prevEl) renderPreview(prevEl, p, f(`${this.id}-jobname`), resolved, fwVal === 'auto');

      if (!p.image) return '# ⚠ Could not detect image — is this a valid docker run command?';

      const autoName    = imageToJobName(p.image);
      const jobname     = f(`${this.id}-jobname`).trim() || autoName;
      const port        = p.ports[0] || '7860';
      const userEnvVars = parseEnvLines(f(`${this.id}-envvars`));
      const allEnvVars  = mergeEnvVars(userEnvVars, fwEnvVars);

      return cmd(
        `runai workspace submit ${jobname}`,
        `-i ${p.image}`,
        `-p ${lower(project)}`,
        gpuFlag(f(`${this.id}-gpu`)),
        allEnvVars.map(e => `-e ${e}`),
        `--external-url container=${port},authgroups=${project}`,
        ...(p.command.length ? [`--command -- ${p.command.join(' ')}`] : []),
      );
    },
  },

  // ── Add new workload types above this line ─────────────────────────────────

]; // end WORKLOADS
