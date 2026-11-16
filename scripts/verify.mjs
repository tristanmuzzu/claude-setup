#!/usr/bin/env node
// Checks that the claude-setup core is installed and working.
//
//   node scripts/verify.mjs
//
// Every check prints PASS, WARN or FAIL. Exit code 1 if anything FAILs.
// It runs the two safety hooks for real against sample commands (nothing is
// executed; the hooks only judge the text) and makes one throwaway git repo in
// the OS temp folder to prove the autosave snapshot works.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const CH = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
let fails = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const warn = (m) => console.log(`WARN  ${m}`);
const fail = (m) => { fails++; console.log(`FAIL  ${m}`); };

function check(cond, ok, bad, level = fail) { cond ? pass(ok) : level(bad); }

// 1. Files
for (const f of ['docs/engineering.md', 'docs/model-routing.md', 'docs/model-notes.md', 'docs/harness.md',
  'agents/reviewer.md', 'hooks/guard-irreversible.js', 'hooks/autosave-git.js',
  'skills/frontend-design/SKILL.md', 'skills/verified-deployment/SKILL.md',
  'skills/wizard/SKILL.md', 'skills/cinematic-3d/SKILL.md', 'skills/media-and-motion/SKILL.md',
  'bin/frames.py', 'bin/blender-mcp-lazy.py']) {
  check(fs.existsSync(path.join(CH, f)), `${f} present`, `${f} missing: run node scripts/install.mjs`);
}

// 2. CLAUDE.md written from the template
const claudeMd = path.join(CH, 'CLAUDE.md');
if (!fs.existsSync(claudeMd)) fail('CLAUDE.md missing: write it from home/CLAUDE.template.md');
else {
  const t = fs.readFileSync(claudeMd, 'utf8');
  check(!/\{\{[A-Z_]+\}\}/.test(t), 'CLAUDE.md has no unfilled {{PLACEHOLDERS}}', 'CLAUDE.md still has {{PLACEHOLDERS}}');
  check(t.includes('@~/.claude/docs/model-notes.md'), 'CLAUDE.md imports model-notes.md', 'CLAUDE.md does not import model-notes.md', warn);
}

// 3. settings.json wiring
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(path.join(CH, 'settings.json'), 'utf8'));
  pass('settings.json is valid JSON');
} catch (e) { fail(`settings.json unreadable: ${e.message}`); }
const pre = JSON.stringify(settings.hooks?.PreToolUse || []);
for (const h of ['guard-irreversible.js', 'autosave-git.js']) {
  check(pre.includes(h), `${h} wired as a PreToolUse hook`, `${h} not wired in settings.json`);
}
for (const p of ['session-map@tristan-mods', 'working-dot@tristan-mods']) {
  check(settings.enabledPlugins?.[p] === true, `${p} enabled in settings`, `${p} not enabled in settings`);
}

// 4. Mods actually installed (the app installs them on the next start)
try {
  const inst = JSON.parse(fs.readFileSync(path.join(CH, 'plugins', 'installed_plugins.json'), 'utf8'));
  for (const p of ['session-map@tristan-mods', 'working-dot@tristan-mods']) {
    check(Boolean(inst.plugins?.[p]), `${p} installed`, `${p} not installed yet (install it, then restart the app)`, warn);
  }
} catch { warn('no plugins/installed_plugins.json yet: install the mods, then restart the app'); }

// 5. The guard judges real commands
const node = process.execPath;
const guard = path.join(CH, 'hooks', 'guard-irreversible.js');
function judge(command) {
  const r = spawnSync(node, [guard], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: os.tmpdir(), session_id: 'verify' }),
    encoding: 'utf8', timeout: 15000,
  });
  if (r.error) return { error: r.error.message };
  if (!r.stdout.trim()) return { decision: 'none' };
  try { return { decision: JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision || 'none' }; }
  catch { return { error: `unexpected output: ${r.stdout.slice(0, 120)}` }; }
}
if (fs.existsSync(guard)) {
  // Built from parts so this file itself never contains the literal commands.
  const risky = ['git', 'push', '--force', 'origin', 'main'].join(' ');
  const wipe = ['rm', '-rf', '~'].join(' ');
  const r1 = judge(risky);
  check(r1.decision === 'deny' || r1.decision === 'ask', `guard stops a force-push (${r1.decision || r1.error})`, `guard let a force-push through (${r1.decision || r1.error})`);
  // Note: the guard deliberately allows deleting temp and scratch folders, so
  // this check is only meaningful when the home folder is not inside one.
  const r2 = judge(wipe);
  check(r2.decision === 'deny' || r2.decision === 'ask', `guard stops deleting the home folder (${r2.decision || r2.error})`, `guard let a home-folder delete through (${r2.decision || r2.error})`);
  const r3 = judge('ls -la');
  check(r3.decision === 'none' || r3.decision === 'allow', `guard leaves ordinary commands alone (${r3.decision || r3.error})`, `guard interfered with "ls -la" (${r3.decision || r3.error})`);
}

// 6. Autosave snapshots before a destructive git command
const autosave = path.join(CH, 'hooks', 'autosave-git.js');
if (fs.existsSync(autosave)) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-setup-verify-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf8' });
    git('init', '-q');
    git('-c', 'user.name=verify', '-c', 'user.email=verify@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
    fs.writeFileSync(path.join(repo, 'work.txt'), 'uncommitted work\n');
    const cmd = ['git', 'reset', '--hard'].join(' ');
    spawnSync(node, [autosave], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: repo, session_id: 'verify' }),
      encoding: 'utf8', timeout: 20000, cwd: repo,
    });
    const refs = git('for-each-ref', '--format=%(refname)', 'refs/harness/autosave').trim();
    check(refs.length > 0, 'autosave snapshots uncommitted work before a destructive git command',
      'autosave made no snapshot (is git on PATH?)');
  } catch (e) {
    warn(`autosave check skipped: ${e.message.split('\n')[0]}`);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

console.log(fails ? `\n${fails} check(s) failed.` : '\nAll required checks passed.');
process.exit(fails ? 1 : 0);
