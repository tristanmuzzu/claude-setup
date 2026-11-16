#!/usr/bin/env node
// Installs the claude-setup core into ~/.claude (or $CLAUDE_CONFIG_DIR).
//
//   node scripts/install.mjs            install or update
//   node scripts/install.mjs --dry-run  show what would change, write nothing
//
// Options from the setup interview (AGENT-SETUP.md step 3):
//   --auto-mode               start new chats in auto mode (permissions.defaultMode)
//   --publish-authority=USER  let the auto-mode check allow publishing the
//                             user's own projects (GitHub account USER) to their
//                             live destination, and creating private repos there
//
// What it does:
//   - copies home/docs, agents, hooks, skills and bin into ~/.claude
//   - merges settings/settings.base.json into ~/.claude/settings.json
//   - backs up every file it would change to ~/.claude/backups/claude-setup-<time>/
//
// What it never does: overwrite CLAUDE.md, remove anything you already have,
// or change a setting you already set (except permissions.defaultMode when you
// pass --auto-mode). Lists (permissions, autoMode rules) are unioned,
// hooks are appended only if the same hook file is not already wired, and
// plugins and marketplaces are added only when missing.
//
// Works on Windows, macOS and Linux with Node 18+. No dependencies.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DRY = process.argv.includes('--dry-run');
const AUTO = process.argv.includes('--auto-mode');
const PUBLISH_USER = (process.argv.find(a => a.startsWith('--publish-authority=')) || '').split('=')[1] || '';
if (PUBLISH_USER && !/^[A-Za-z0-9-]{1,39}$/.test(PUBLISH_USER)) {
  console.error(`--publish-authority needs a GitHub user name, got "${PUBLISH_USER}".`);
  process.exit(1);
}
const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CH = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP = path.join(CH, 'backups', `claude-setup-${STAMP}`);
// Forward slashes work in hook commands on every OS, including Git Bash on Windows.
const CH_FWD = CH.split(path.sep).join('/');

// Absolute path of the `node` found on PATH (the launcher path, not its
// resolved target, so it survives Node upgrades). Hooks need it: apps started
// from the macOS Dock or Windows Start menu may not see the shell's PATH.
function findNode() {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, 'node' + ext);
      try { if (fs.statSync(p).isFile()) return p.split(path.sep).join('/'); } catch { /* keep looking */ }
    }
  }
  return process.execPath.split(path.sep).join('/');
}
const NODE = findNode();

const log = (...a) => console.log(...a);
const changed = [];
const backedUp = [];

function backup(abs) {
  if (!fs.existsSync(abs)) return;
  const rel = path.relative(CH, abs);
  const dest = path.join(BACKUP, rel);
  backedUp.push(rel);
  if (DRY) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(abs, dest);
}

function writeFile(abs, buf) {
  if (fs.existsSync(abs) && Buffer.compare(fs.readFileSync(abs), buf) === 0) return;
  backup(abs);
  changed.push(path.relative(CH, abs));
  if (DRY) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

function copyTree(srcDir, destDir) {
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(destDir, ent.name);
    if (ent.isDirectory()) copyTree(s, d);
    else if (ent.isFile()) writeFile(d, fs.readFileSync(s));
  }
}

function unionList(have = [], add = []) {
  const out = [...have];
  for (const x of add) if (!out.includes(x)) out.push(x);
  return out;
}

function mergeSettings(cur, base) {
  const out = structuredClone(cur);
  for (const [k, v] of Object.entries(base)) {
    if (k === 'permissions') {
      out.permissions = out.permissions || {};
      for (const [pk, pv] of Object.entries(v)) {
        if (Array.isArray(pv)) out.permissions[pk] = unionList(out.permissions[pk], pv);
        else if (!(pk in out.permissions)) out.permissions[pk] = pv;
      }
    } else if (k === 'hooks') {
      out.hooks = out.hooks || {};
      for (const [event, groups] of Object.entries(v)) {
        const existing = out.hooks[event] || [];
        const wired = JSON.stringify(existing);
        for (const g of groups) {
          // A hook is "already wired" if its script file name appears anywhere
          // in this event, whatever runtime or path the user chose.
          const files = g.hooks.map(h => (h.command.match(/hooks\/([\w.-]+\.(?:js|mjs|sh))/) || [])[1]).filter(Boolean);
          if (files.length && files.every(f => wired.includes(f))) continue;
          existing.push(g);
        }
        out.hooks[event] = existing;
      }
    } else if (k === 'autoMode') {
      // Union each rule list, so a kit update adds new rules without
      // dropping any the user wrote.
      out.autoMode = out.autoMode || {};
      for (const [ak, av] of Object.entries(v)) out.autoMode[ak] = unionList(out.autoMode[ak], av);
    } else if (k === 'modelSettings') {
      out.modelSettings = out.modelSettings || {};
      for (const [m, mv] of Object.entries(v)) if (!(m in out.modelSettings)) out.modelSettings[m] = mv;
    } else if (k === 'enabledPlugins' || k === 'extraKnownMarketplaces') {
      out[k] = out[k] || {};
      for (const [name, val] of Object.entries(v)) if (!(name in out[k])) out[k][name] = val;
    } else if (!(k in out)) {
      out[k] = v;
    }
  }
  return out;
}

function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    console.error(`Node ${process.versions.node} is too old; install Node 18 or newer.`);
    process.exit(1);
  }
  log(`${DRY ? '[dry run] ' : ''}Installing claude-setup into ${CH}`);

  for (const dir of ['docs', 'agents', 'hooks', 'skills', 'bin']) {
    copyTree(path.join(KIT, 'home', dir), path.join(CH, dir));
  }

  const settingsPath = path.join(CH, 'settings.json');
  let cur = {};
  if (fs.existsSync(settingsPath)) {
    try {
      cur = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      console.error(`${settingsPath} is not valid JSON (${e.message}). Fix it first; nothing was changed.`);
      process.exit(1);
    }
  }
  const baseText = fs.readFileSync(path.join(KIT, 'settings', 'settings.base.json'), 'utf8')
    .replaceAll('{{CLAUDE_HOME}}', CH_FWD)
    .replaceAll('{{NODE}}', NODE);
  const base = JSON.parse(baseText);
  if (AUTO) base.permissions.defaultMode = 'auto';
  if (PUBLISH_USER) {
    base.autoMode.environment.push(
      `Standing publication authority (recorded in ~/.claude/CLAUDE.md): for the user's own apps, sites and tools (repos under github.com/${PUBLISH_USER} and their hosting), deploying or publishing a change they asked for to its established live destination is authorized without a second confirmation, including production aliases. Excluded: employer or client production systems, messages to other people, purchases, and deleting data or accounts.`,
      `Private repositories: creating a private GitHub repository under ${PUBLISH_USER} for one of the user's own local projects (gh repo create --private) and pushing to it is routine version control, not data sharing. A public repository still needs their explicit ask.`,
    );
  }
  const merged = mergeSettings(cur, base);
  // The one deliberate override: the person just chose auto mode in the
  // interview, so it wins over an older defaultMode (backed up first).
  if (AUTO) merged.permissions.defaultMode = 'auto';
  writeFile(settingsPath, Buffer.from(JSON.stringify(merged, null, 2) + '\n'));

  const kitVersion = fs.readFileSync(path.join(KIT, 'VERSION'), 'utf8').trim();
  writeFile(path.join(CH, 'claude-setup.json'), Buffer.from(JSON.stringify({
    kit: 'https://github.com/tristanmuzzu/claude-setup',
    version: kitVersion,
    installedAt: new Date().toISOString(),
  }, null, 2) + '\n'));

  log(`Changed ${changed.length} file(s):`);
  for (const f of changed) log(`  ${f}`);
  if (backedUp.length) log(`Backed up ${backedUp.length} existing file(s) to ${BACKUP}`);
  if (!fs.existsSync(path.join(CH, 'CLAUDE.md'))) {
    log('No CLAUDE.md yet: write it from home/CLAUDE.template.md (see AGENT-SETUP.md step 3).');
  }
  log(DRY ? 'Dry run: nothing was written.' : 'Done. Start a new chat so the hooks and settings load.');
}

main();
