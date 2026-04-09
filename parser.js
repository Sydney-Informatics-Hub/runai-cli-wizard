'use strict';

// ══════════════════════════════════════════════════════════════════════════════
// parser.js — Docker run command parser and env-var utilities
// No dependencies on other project files.
// ══════════════════════════════════════════════════════════════════════════════

// Flags that consume the next token as their value
const DOCKER_VALUE_FLAGS = new Set([
  '-p','--publish','-e','--env','--gpus','--platform','--name','-u','--user',
  '--network','--runtime','--shm-size','-v','--volume','--entrypoint',
  '-w','--workdir','-l','--label','--add-host','--cap-add','--device',
  '--memory','-m','--cpus','--ipc','--dns','--restart','--security-opt',
  '--ulimit','--health-cmd','--health-interval',
]);

// Boolean flags (no following value)
const DOCKER_BOOL_FLAGS = new Set([
  '-it','-i','-t','-d','--rm','--detach','--interactive','--tty',
  '--privileged','--no-healthcheck','-P','--publish-all','--init','--read-only',
]);

/**
 * Tokenise a shell command string, respecting quoted strings and
 * line continuations (backslash-newline).
 */
function tokenizeShell(input) {
  const str = input.replace(/\\\n\s*/g, ' ').trim();
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /\s/.test(str[i])) i++;
    if (i >= str.length) break;
    let tok = '';
    while (i < str.length && !/\s/.test(str[i])) {
      const c = str[i];
      if (c === '"') {
        i++;
        while (i < str.length && str[i] !== '"') { if (str[i] === '\\') i++; tok += str[i++] ?? ''; }
        i++;
      } else if (c === "'") {
        i++;
        while (i < str.length && str[i] !== "'") tok += str[i++];
        i++;
      } else {
        tok += str[i++];
      }
    }
    if (tok) tokens.push(tok);
  }
  return tokens;
}

/**
 * Parse a `docker run …` command string into its components.
 * Returns { envVars: string[], ports: string[], gpus: string|null,
 *           image: string|null, command: string[] }
 */
function parseDockerRun(input) {
  const tokens = tokenizeShell(input);
  const r = { envVars: [], ports: [], gpus: null, image: null, command: [] };
  let i = 0;
  if (tokens[i] === 'docker') i++;
  if (tokens[i] === 'run')    i++;
  while (i < tokens.length) {
    const tok = tokens[i];
    if      (tok === '-e' || tok === '--env')         { if (++i < tokens.length) r.envVars.push(tokens[i]); }
    else if (/^-e.+/.test(tok))                       { r.envVars.push(tok.slice(2)); }
    else if (tok === '-p' || tok === '--publish')      { if (++i < tokens.length) r.ports.push(tokens[i].split(':').pop()); }
    else if (/^-p\d/.test(tok))                       { r.ports.push(tok.slice(2).split(':').pop()); }
    else if (tok === '--gpus')                         { if (++i < tokens.length) r.gpus = tokens[i]; }
    else if (DOCKER_BOOL_FLAGS.has(tok))               { /* no-op */ }
    else if (DOCKER_VALUE_FLAGS.has(tok))              { i++; }
    else if (!tok.startsWith('-'))                     { r.image = tok; r.command = tokens.slice(i + 1); break; }
    i++;
  }
  return r;
}

/** Derive a RunAI-safe job name from a docker image reference */
function imageToJobName(image) {
  return image.split('/').pop().split(':')[0]
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
}

/** Parse a multiline KEY=VALUE block; lines starting with # are ignored */
function parseEnvLines(text) {
  return text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

// ── Env var auto-population ────────────────────────────────────────────────

/** Tracks the last string auto-populated into each workload's env vars textarea,
 *  so we can tell whether the user has manually edited it. */
const autoEnvSnapshots = {};

/**
 * Auto-populate a workload's env vars textarea from parsed docker env vars,
 * unless the user has already manually changed it.
 */
function autoPopulateEnvVars(wlId, envVars) {
  const el = document.getElementById(`${wlId}-envvars`);
  if (!el) return;
  const newVal = envVars.join('\n');
  if (!el.value.trim() || el.value === autoEnvSnapshots[wlId]) {
    el.value = newVal;
    autoEnvSnapshots[wlId] = newVal;
  }
}

/**
 * Reset the env vars textarea to whatever the current docker command produces.
 * Called from the "↺ Reset" button inline onclick.
 */
function resetEnvVars(wlId) {
  const dockerEl = document.getElementById(`${wlId}-docker`);
  const envEl    = document.getElementById(`${wlId}-envvars`);
  if (!dockerEl || !envEl) return;
  const parsed = parseDockerRun(dockerEl.value);
  envEl.value = parsed.envVars.join('\n');
  autoEnvSnapshots[wlId] = envEl.value;
  save();           // defined in app.js
  renderOutput();   // defined in app.js
}
