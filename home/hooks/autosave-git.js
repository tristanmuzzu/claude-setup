#!/usr/bin/env node
/*
 * PreToolUse:Bash — snapshot the working tree before a git command that can
 * destroy uncommitted work, then get out of the way.
 *
 * Why this exists (2026-08-10): the user runs agents unattended and cannot
 * inspect an irreversible action while away. Prompting on every risky git
 * command would defeat the point. The alternative is to remove the
 * irreversibility: capture tracked AND untracked state into a ref first, so
 * `git reset --hard`, `git restore .` and `git clean -fd` stop being one-way.
 *
 * The snapshot is a real commit under refs/harness/autosave/<timestamp>, made
 * with a throwaway index so the user's staged changes are untouched. Recover
 * with:
 *
 *   git log --oneline refs/harness/autosave/*
 *   git checkout <ref> -- .          # restore files into the worktree
 *   git switch -c rescue <ref>       # or take the whole snapshot as a branch
 *
 * It writes a marker to /run/user/<uid>/claude-autosave/ recording that a fresh
 * snapshot exists. guard-irreversible.js reads that marker and downgrades those
 * git commands from ASK to ALLOW, so protection is what buys the autonomy —
 * no marker, no downgrade.
 *
 * NEVER blocks. Every failure path exits 0 with no output.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEEP_REFS = 50;

function out() { process.exit(0); }

// Commands that can discard uncommitted or unreferenced work.
const DESTRUCTIVE_GIT = /\bgit\b[^|;&\n]*\b(reset|restore|checkout|clean|stash|rebase|merge|revert|switch|branch|filter-branch|filter-repo)\b/;

function markerDir() {
  const base = process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `claude-${process.getuid ? process.getuid() : 0}`);
  const dir = path.join(base, 'claude-autosave');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function git(args, cwd, extraEnv) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: Object.assign({}, process.env, extraEnv || {}),
  }).trim();
}

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch { out(); }

let payload;
try { payload = JSON.parse(raw); } catch { out(); }

try {
  const tool = payload.tool_name || payload.toolName;
  if (tool !== 'Bash') out();

  const input = payload.tool_input || payload.toolInput || {};
  const cmd = input.command;
  if (typeof cmd !== 'string' || !DESTRUCTIVE_GIT.test(cmd)) out();

  const cwd = payload.cwd || input.cwd || process.cwd();

  let root;
  try { root = git(['rev-parse', '--show-toplevel'], cwd); } catch { out(); }
  if (!root) out();

  // Nothing to lose: a clean tree is already fully represented by its commits.
  let dirty = '';
  try { dirty = git(['status', '--porcelain'], root); } catch { out(); }
  if (!dirty) out();

  // Throwaway index, so the real staging area is not disturbed.
  const tmpIndex = path.join(markerDir(), `index-${process.pid}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  let ref = null;
  try {
    git(['add', '-A'], root, env);
    const tree = git(['write-tree'], root, env);
    let parent = null;
    try { parent = git(['rev-parse', 'HEAD'], root); } catch { /* unborn branch */ }
    const args = ['commit-tree', tree, '-m', 'harness autosave before a destructive git command'];
    if (parent) args.splice(2, 0, '-p', parent);
    // Fixed identity: commit-tree fails with "Author identity unknown" on a
    // machine where git has no user.name/user.email yet, and the snapshot
    // would silently not happen. A labelled identity also makes these commits
    // easy to tell apart from real work.
    const commit = git(args, root, Object.assign({
      GIT_AUTHOR_NAME: 'claude autosave',
      GIT_AUTHOR_EMAIL: 'autosave@localhost',
      GIT_COMMITTER_NAME: 'claude autosave',
      GIT_COMMITTER_EMAIL: 'autosave@localhost',
    }, env));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    ref = `refs/harness/autosave/${stamp}`;
    git(['update-ref', ref, commit], root);
  } finally {
    try { fs.unlinkSync(tmpIndex); } catch { /* best effort */ }
  }
  if (!ref) out();

  // Keep the ref space bounded.
  try {
    const refs = git(['for-each-ref', '--format=%(refname)', '--sort=-creatordate', 'refs/harness/autosave'], root)
      .split('\n').filter(Boolean);
    for (const stale of refs.slice(KEEP_REFS)) git(['update-ref', '-d', stale], root);
  } catch { /* pruning is best effort */ }

  // Tell the guard a fresh snapshot exists for this repo.
  const key = Buffer.from(root).toString('base64url').slice(0, 64);
  fs.writeFileSync(path.join(markerDir(), key), JSON.stringify({
    repo: root, ref, at: Date.now(),
  }), { mode: 0o600 });
} catch {
  /* never block on a snapshot failure -- the guard still gates the command */
}

out();
