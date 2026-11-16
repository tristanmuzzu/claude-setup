#!/usr/bin/env node
/*
 * PreToolUse guard: the deterministic floor under the auto-mode classifier.
 *
 * History: this file was `block-recursive-delete.js`, itself a port of a .ps1
 * (2026-08-03). Renamed and widened 2026-08-10 after a review of 30,985 real
 * tool calls across 212 sessions. That review found:
 *
 *   - 138 classifier denials, ~2/3 of them false positives, and 16/212 sessions
 *     that escaped to bypassPermissions. A guard that makes the user disable
 *     all guards is worse than the action it prevented.
 *   - One severe miss: on 2026-08-08 a ydotool-injected Ctrl+Alt+F9 threw the
 *     desktop onto a GDM login screen (`switch-to-session` in mutter) and the
 *     machine looked frozen. Nothing stopped it.
 *   - 35 agent-authored scripts containing always-block patterns in their body,
 *     at least 3 of which were then executed as files. Every guard layer read
 *     only the string `bash healthcheck.sh` and had no opinion. Three layers
 *     sharing one blind spot are not three layers.
 *   - ~28 stalls where the classifier model was unavailable and no decision
 *     could be made at all. A parser has no outage mode.
 *
 * Division of labour with the classifier (see settings.json autoMode):
 *   this file  -> the stable, incident-earned set. Identity rules here are a
 *                 CACHE of an answer that never changes, not a worse model.
 *   classifier -> judgment: prod writes, external publish, egress to unnamed
 *                 destinations, self-privilege, provenance of the instruction.
 *
 * The decision model both layers share:
 *   Q1 is anything lost that cannot be REGENERATED? (node_modules and scratch
 *      regenerate; .git history, uncommitted work and prod rows do not)
 *   Q2 does it reach past this machine?
 *   Q3 does it remove the ability to check my own work?
 *   Block on Q3 alone, or Q1 and Q2 together.
 *
 * Q3 is the priority. An action that blinds the agent is worse than one that
 * breaks something visible, because the next mistake then compounds unchecked.
 *
 * Approach, unchanged from the port: parse, never pattern-match a flattened
 * string. A pattern inside a string literal is an argument, never an
 * invocation. Heredoc bodies destined for a FILE are not scanned at write time
 * (that produced 32 needless blocks in the corpus) -- they are scanned at
 * execution time instead, by reading the file off disk.
 *
 * Failure policy: fail OPEN on parse errors, EXCEPT when the raw command
 * mentions rm/sudo/dd/mkfs/ydotool -- there it fails CLOSED, because the
 * settings.json glob net for those was deliberately narrowed on 2026-08-10 and
 * this is now the binding layer.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// --- platform (Windows port, 2026-11-14) -------------------------------------
//
// This file was written on Ubuntu/GNOME and now also runs on Windows 11, where
// the Bash tool is Git Bash and the PowerShell tool is pwsh 7. It must run under
// plain `node` (bun is not installed there) and still under bun on Linux.
//
// Two rule sets are platform-specific and gated here rather than deleted:
//   LINUX_RULES   -- desktop/VT/systemd/firewall/journal rules (checkObserverLoss)
//                    and the cgroup memory-cap stand-down. On Windows none of
//                    those binaries exist; `wsl <cmd>` re-enables them per segment.
//   WIN_RULES     -- disk, boot, registry, services, shutdown, event-log rules
//                    (checkWindowsSystem), the Windows equivalents of the Linux
//                    tiers, not new policy.
// GUARD_PLATFORM=linux|win32 forces one set, so the Linux replay suite can be run
// unchanged on this machine and the Windows table on any machine.
const IS_WIN = process.platform === 'win32';
const GUARD_PLATFORM = String(process.env.GUARD_PLATFORM || (IS_WIN ? 'win32' : 'linux')).toLowerCase();
const LINUX_RULES = GUARD_PLATFORM !== 'win32';
const WIN_RULES = GUARD_PLATFORM === 'win32';
// os.homedir() works everywhere; $HOME is unset in a hook spawned by the
// Windows desktop app, and `process.env.HOME || '/tmp'` silently mis-pointed
// every home-relative path there.
const HOME = os.homedir() || process.env.HOME || process.env.USERPROFILE || '';

// Which shell grammar the top-level command is in. Set in main from tool_name.
let SHELL_MODE = 'bash';

// Lowercased command name with directory, leading `\` and a Windows executable
// extension removed: `C:\Program Files\Git\cmd\git.exe` and `\rm` are `git` and
// `rm`. Splits on both separators so it behaves the same on every platform.
function baseOf(tok) {
  const s = String(tok || '').split(/[\\/]/).pop().toLowerCase();
  return s.replace(/\.(exe|cmd|bat|com)$/, '');
}

// Environment lookup that knows $HOME is not guaranteed on Windows.
function envLookup(n) {
  if (process.env[n] !== undefined && process.env[n] !== '') return process.env[n];
  const u = String(n).toUpperCase();
  if (u === 'HOME' || u === 'USERPROFILE') return HOME || undefined;
  if (u === 'TEMP' || u === 'TMP' || u === 'TMPDIR') return os.tmpdir();
  return undefined;
}

// A path as the filesystem will see it. Git Bash writes `/c/Users/x` and `~`;
// node on Windows would resolve `/c/Users/x` to `C:\c\Users\x`, which does not
// exist -- and "does not exist" is read as "nothing to lose" by the provenance
// test, so this conversion is load-bearing, not cosmetic.
function toNative(p) {
  let s = String(p).replace(/^~(?=[\/\\]|$)/, HOME || '~');
  if (IS_WIN) {
    s = s.replace(/^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?=\/|$)/, '$1:');
    if (/^[a-zA-Z]:$/.test(s)) s += '/';
    s = s.replace(/^\/tmp(?=\/|$)/i, os.tmpdir().replace(/\\/g, '/'));
  }
  return s;
}

function toAbs(p, cwd) {
  const n = toNative(p);
  if (path.isAbsolute(n)) return path.resolve(n);
  return path.resolve(toNative(cwd || process.cwd()), n);
}

// --- decision log (2026-08-16) ----------------------------------------------
//
// Until now nothing recorded what this guard actually decided. The only reason
// the 2026-08-16 prompt-volume review could measure anything is that PreToolUse
// stdout happens to land in the session transcript; classifier prompts that
// the user approved left no trace at all. Tuning a permission surface without
// that record is guessing, so every verdict is now appended here and
// `scripts/prompt-report.js` in the harness-improvements repo renders it.
//
// Never fatal: a guard that wedges a session over a log file is worse than no
// log. Every failure path is swallowed.
// GUARD_LOG_PATH exists so the suites can spawn this hook with a real session
// id (which the provenance test needs) without writing test rows into the real
// history. The first run of the logger did exactly that.
const LOG_PATH = process.env.GUARD_LOG_PATH ||
  path.join(HOME || os.tmpdir(), '.claude', 'logs', 'guard-decisions.jsonl');
const LOG_MAX_BYTES = 5 * 1024 * 1024;
let LOG_CONTEXT = {};

function logDecision(tier, why) {
  // Only a real session is worth a row. The replay suites spawn this file
  // hundreds of times with synthetic payloads that carry no session id, and the
  // first run of the logger buried a week of real history under 465 test rows.
  if (!LOG_CONTEXT.session) return;
  try {
    const dir = path.dirname(LOG_PATH);
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) {
        fs.renameSync(LOG_PATH, LOG_PATH + '.1');
      }
    } catch { /* no log yet */ }
    fs.appendFileSync(LOG_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      tier,
      session: LOG_CONTEXT.session || null,
      cwd: LOG_CONTEXT.cwd || null,
      cmd: String(LOG_CONTEXT.cmd || '').slice(0, 400),
      why: String(why || '').slice(0, 300),
    }) + '\n');
  } catch { /* never fatal */ }
}

function allow() {
  // Only Bash/PowerShell commands are worth a row; the `*` matcher fires this
  // hook for every tool, and logging those would bury the signal.
  if (LOG_CONTEXT.cmd) logDecision('fallthrough', '');
  process.exit(0); // no output => fall through to normal permission rules
}

function grant(why) {
  logDecision('allow', why);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: why,
    },
  }));
  process.exit(0);
}

function decide(tier, why) {
  logDecision(tier, why);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: tier,
      permissionDecisionReason: why,
    },
  }));
  process.exit(0);
}

// --- verdict tiers ----------------------------------------------------------
//
// Added 2026-08-10. Until then every rule emitted `deny`, which is terminal —
// there was no way for the user to say yes. Nineteen rule messages literally read
// "ask the user", and the mechanism gave them nothing to answer. That is the wrong
// shape twice over: it turns a recoverable judgement call into a wall, and a
// wall is what drives someone to switch the guard off entirely.
//
//   DENY — no legitimate use on this machine. No prompt is worth showing.
//   ASK  — plausibly intended, but the user decides. They see the reason and
//          approves or refuses. Nothing runs without an explicit yes.
//
// The test for DENY is not "how bad is the outcome" — it is "could a reasonable
// answer ever be yes". Formatting a USB stick is a yes; injecting Ctrl+Alt+F2
// never is.
const DENY = (why) => ({ tier: 'deny', why });
const ASK = (why) => ({ tier: 'ask', why });

// A rule that returns a bare string means ASK. That is the safe default here,
// not a lax one: `ask` still runs nothing without an explicit human yes, so the
// failure mode is "the user is interrupted", never "it happened anyway". Making
// ASK the default and DENY the enumerated exception also puts the burden of
// proof in the right place — a terminal block has to be argued for by name.
function asVerdict(r) {
  if (!r) return null;
  if (typeof r === 'string') return { tier: 'ask', why: r };
  return r;
}

// Never ask (2026-11-16): the original author approved 55 guard prompts
// in 10 days without reading them -- 55 prompts in 10 days were approved
// unread, so ASK protected nothing and cost an interruption each time. What
// they wanted instead: genuinely dangerous actions are stopped outright and the
// agent finds another way. So every ASK leaves this hook as a DENY whose text
// names the safer route, and the agent, not the user, takes it. The tiers stay
// separate inside the rules (ASK = "a safer route exists", DENY = "never"), so
// GUARD_ALLOW_ASK=1 restores the old prompts without touching a rule.
function finalTier(v) {
  if (v.tier !== 'ask' || process.env.GUARD_ALLOW_ASK === '1') return [v.tier, v.why];
  const why = v.why.replace(/,? ?(or )?ask the user( for an explicit approval)?( and name what goes in it)?\.?/g, '.')
    .replace(/\.\./g, '.').replace(/ -- \./g, '.');
  return ['deny', why + '\n\nBlocked, not sent for approval: the user does not approve commands one at a ' +
    'time. Take the safer route named above. If nothing safer does the job, finish everything else and ' +
    'name this one step, with the exact command, in your final reply.'];
}

// Re-wrap a nested verdict's text while preserving its tier.
function rewrap(v, prefix, suffix) {
  const n = asVerdict(v);
  return n && { tier: n.tier, why: prefix + n.why + (suffix || '') };
}

// --- heredocs ---------------------------------------------------------------

// A heredoc body is data when it is being written to a file, and code when it
// is piped into an interpreter on stdin. Strip the first kind, keep the second.
const STDIN_INTERPRETERS = /(^|[\s|])(bash|sh|zsh|dash|ksh|python3?|node|perl|ruby|pwsh|psql|mysql)\b[^\n]*(\s-s?\s*$|\s-\s)/;

function stripHeredocs(cmd) {
  const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  let out = cmd;
  let m;
  const spans = [];
  while ((m = re.exec(cmd)) !== null) {
    const delim = m[2];
    const lineStart = cmd.lastIndexOf('\n', m.index) + 1;
    const opener = cmd.slice(lineStart, m.index);
    const bodyStart = cmd.indexOf('\n', m.index);
    if (bodyStart < 0) continue;
    const endRe = new RegExp('^\\s*' + delim + '\\s*$', 'm');
    const rest = cmd.slice(bodyStart + 1);
    const endM = endRe.exec(rest);
    const bodyEnd = endM ? bodyStart + 1 + endM.index + endM[0].length : cmd.length;
    // Executed on stdin => leave the body in place so it gets scanned.
    if (STDIN_INTERPRETERS.test(opener)) continue;
    spans.push([bodyStart + 1, bodyEnd]);
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    out = out.slice(0, spans[i][0]) + out.slice(spans[i][1]);
  }
  return out;
}

// --- tokenising -------------------------------------------------------------

// Split on shell separators that start a NEW command, ignoring any that appear
// inside quotes. This is what stops `echo "a && rm -rf x"` from being read as
// two commands.
// PowerShell additions (mode 'powershell'): `<# ... #>` block comments are
// dropped, a backtick line continuation is joined, and `{` / `}` also start a
// new command -- `gci | ForEach-Object { Remove-Item $_ -Recurse }` would
// otherwise read as one command whose head is ForEach-Object. Bash keeps its
// braces: `find -exec rm {} +` and `${VAR}` must stay intact.
// keepPipes leaves single `|` in place, for the pipeline-aware checks.
function splitSegments(cmd, mode, keepPipes) {
  const ps = (mode || SHELL_MODE) === 'powershell';
  if (ps) cmd = String(cmd).replace(/<#[\s\S]*?#>/g, ' ').replace(/`\r?\n/g, ' ');
  const out = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      if (c === quote) quote = null;
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    // An unquoted `#` at a token boundary starts a comment. Without this,
    // `rm -rf .git # safe to reinit` reads "#" and "safe" as delete targets.
    if (c === '#' && (buf === '' || /\s$/.test(buf))) {
      const nl = cmd.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      out.push(buf); buf = '';
      continue;
    }
    if (keepPipes && c === '|' && cmd[i + 1] !== '|') { buf += c; continue; }
    if (c === ';' || c === '\n' || c === '\r' || c === '|' || c === '&' || (ps && (c === '{' || c === '}'))) {
      if ((c === '|' || c === '&') && cmd[i + 1] === c) i++;
      out.push(buf); buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out.filter((s) => s.trim());
}

// Split one statement on single `|` outside quotes.
function splitPipes(stmt) {
  const out = [];
  let buf = '';
  let quote = null;
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i];
    if (quote) { if (c === quote) quote = null; buf += c; continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '|') { out.push(buf); buf = ''; continue; }
    buf += c;
  }
  out.push(buf);
  return out.filter((s) => s.trim());
}

function tokenise(seg) {
  const toks = [];
  let buf = '';
  let quote = null;
  let started = false;
  const push = () => { if (started || buf) { toks.push(buf); buf = ''; started = false; } };
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (quote) {
      if (c === quote) { quote = null; started = true; } else buf += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (/\s/.test(c)) { push(); continue; }
    buf += c;
  }
  push();
  // PowerShell accepts an en/em dash as the parameter prefix (`–Recurse`).
  return toks.map((t) => t.replace(/^[–—―]/, '-'));
}

// --- classification ---------------------------------------------------------

const RM_NAMES = new Set(['rm']);
// Remove-Item and every alias pwsh 7 / cmd ship for it. `rm` is also an alias
// in PowerShell, which is why the recursive-flag test below accepts both the
// unix (`-rf`) and the PowerShell (`-Recurse`, `-rec`, `-r`) spellings for all.
const PS_REMOVE = new Set(['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
// cmd.exe builtins whose `/s` switch means "the whole tree".
const CMD_TREE_DELETE = new Set(['rd', 'rmdir', 'del', 'erase']);
// Tools that are recursive by definition, so there is no flag to look for.
// `npx rimraf <repo>` was allowed because the head was `npx` and, once that was
// unwrapped, because `rimraf` was not a name the guard knew.
const RECURSIVE_ALWAYS = new Set(['rimraf', 'del-cli', 'trash', 'trash-cli']);

// Wrappers whose real command follows: strip them and re-inspect. `sudo` is
// recorded rather than silently dropped -- on this machine sudo is passwordless
// (passwordless sudo), so it is not a gate and several rules
// below need to know it was present.
//
// 2026-08-10 (adversarial replay): the original list was `sudo|command|nohup|
// time|env|timeout` only, so `nice -n 5 rm -rf <repo>`, `setsid rm -rf <repo>`,
// `ionice rm -rf <repo>` and `\rm -rf <repo>` all reached checkDelete with a
// head that was not `rm`, and were allowed. `sudo -u me rm -rf <repo>` had
// the same effect for a different reason: `-u` was dropped but its VALUE was
// not, so the head became `me`.

// Transparent wrappers: `<wrapper> [flags] <real command>`.
const TRANSPARENT = new Set([
  'command', 'nohup', 'time', 'env', 'nice', 'ionice', 'setsid', 'stdbuf',
  'chrt', 'taskset', 'eatmydata', 'proxychains', 'proxychains4', 'unbuffer',
]);
// Flags that consume the following token as their value.
const WRAPPER_VALUE_FLAGS = /^-(u|U|g|n|c|k|s|p|d|a|I|P|N)$/;

// Skip a wrapper's own option block and land on the real command head.
function skipWrapperFlags(t) {
  while (t.length && t[0].startsWith('-')) {
    if (t[0] === '--') { t = t.slice(1); break; }
    if (WRAPPER_VALUE_FLAGS.test(t[0])) { t = t.slice(2); continue; }
    t = t.slice(1);
  }
  return t;
}

function unwrap(toks) {
  // A leading backslash suppresses alias lookup in bash but runs the same
  // binary: `\rm` IS `rm`.
  let t = toks.slice().map((x, i) => (i === 0 ? String(x).replace(/^\\+(?=[^\\])/, '') : x));
  let sudo = false;
  let wsl = false;
  for (let guard = 0; guard < 8 && t.length; guard++) {
    const head = (t[0] || '').toLowerCase().replace(/^\\+(?=[^\\])/, '');
    const base = baseOf(head);
    if (base === 'sudo' || base === 'doas') {
      sudo = true;
      t = skipWrapperFlags(t.slice(1));
      continue;
    }
    if (TRANSPARENT.has(base)) {
      t = skipWrapperFlags(t.slice(1));
      continue;
    }
    // `timeout [flags] <duration> <command>` -- the duration is positional.
    if (base === 'timeout') {
      t = skipWrapperFlags(t.slice(1));
      if (t.length && /^[\d.]+[smhd]?$/i.test(t[0])) t = t.slice(1);
      continue;
    }
    // `npx [flags] <package> ...` runs the package as a command.
    if (base === 'npx' || base === 'pnpx' || base === 'bunx') {
      t = skipWrapperFlags(t.slice(1));
      continue;
    }
    // `cmd /c <command>`; Git Bash users write `cmd //c` to dodge path
    // conversion. A single quoted payload (`cmd /c "rd /s /q X"`) is re-split.
    if (base === 'cmd') {
      const i = t.findIndex((x) => /^\/{1,2}[ck]$/i.test(x));
      if (i >= 0) {
        t = t.slice(i + 1);
        if (t.length === 1 && /\s/.test(t[0])) t = tokenise(t[0]);
        continue;
      }
    }
    // `wsl [-d distro] [-u user] [--cd dir] [-e|--exec|--] <command>` runs a
    // Linux command, so the Linux-only rules apply to what follows.
    if (base === 'wsl') {
      wsl = true;
      t = t.slice(1);
      while (t.length && t[0].startsWith('-')) {
        if (/^(-e|--exec|--)$/.test(t[0])) { t = t.slice(1); break; }
        if (/^(-d|--distribution|-u|--user|--cd|--shell-type)$/.test(t[0])) { t = t.slice(2); continue; }
        t = t.slice(1);
      }
      if (t.length === 1 && /\s/.test(t[0])) t = tokenise(t[0]);
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) { t = t.slice(1); continue; }
    if (t[0] !== head && !path.isAbsolute(t[0])) t = [head, ...t.slice(1)];
    break;
  }
  const out = t.slice();
  out.sudo = sudo;
  out.wsl = wsl;
  return out;
}

// Linux-only rules apply on Linux, or to a command run through `wsl`.
function linuxRulesOn(toks) {
  return LINUX_RULES || !!(toks && toks.wsl);
}

// --- commands that carry another command in an argument ---------------------

// `bash -c "<cmd>"`, `sh -c`, `xargs <cmd>`, `find ... -exec <cmd> ;`.
// Each of these was a confirmed bypass: the guard parsed the outer head, found
// nothing it recognised, and allowed a payload it never looked at.
const SHELL_DASH_C = /^(bash|sh|zsh|dash|ksh|busybox)$/;

// pwsh/powershell parameters are case-insensitive, accept any unambiguous
// prefix, and accept `/` as well as `-` on Windows.
const PS_HOSTS = new Set(['pwsh', 'powershell', 'powershell_ise']);
const isPsParam = (tok, full, min) => {
  const m = /^[-/]([A-Za-z]+)$/.exec(String(tok));
  if (!m) return false;
  const w = m[1].toLowerCase();
  return w.length >= min && full.startsWith(w);
};

// Decode a -EncodedCommand payload (base64 of UTF-16LE). Returns null when the
// result is not plausibly text, i.e. the guard cannot read it.
function decodePsEncoded(b64) {
  try {
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
    const s = Buffer.from(b64, 'base64').toString('utf16le');
    if (!s || /[\u0000-\u0008\u000e-\u001f]/.test(s)) return null;
    return s;
  } catch { return null; }
}

// Each entry is { cmd, mode, encoded? }. mode is the grammar of the payload,
// which is not always the grammar of the outer command (`bash -c` inside a
// PowerShell call, `pwsh -c` inside Git Bash).
function nestedCommands(toks) {
  const out = [];
  if (!toks.length) return out;
  const base = baseOf(toks[0]);

  if (SHELL_DASH_C.test(base)) {
    for (let i = 1; i < toks.length; i++) {
      if (toks[i] === '-c' || toks[i] === '-lc' || toks[i] === '-cl') {
        if (toks[i + 1]) out.push({ cmd: toks[i + 1], mode: 'bash' });
        break;
      }
    }
    return out;
  }

  // `pwsh -Command <rest...>` runs everything after -Command as one script.
  // `-EncodedCommand <b64>` hides it; it is decoded and judged, and flagged so
  // the caller can ASK even when the decoded text is clean.
  if (PS_HOSTS.has(base)) {
    for (let i = 1; i < toks.length; i++) {
      const tk = toks[i];
      // pwsh documents `-e` and `-ec` as EncodedCommand aliases; `-ex`/`-ep`
      // are ExecutionPolicy and never match a prefix of "encodedcommand".
      if (/^[-/](e|ec)$/i.test(tk) || isPsParam(tk, 'encodedcommand', 2)) {
        const payload = toks[i + 1] || '';
        out.push({ cmd: decodePsEncoded(payload), mode: 'powershell', encoded: true });
        return out;
      }
      if (isPsParam(tk, 'command', 1)) {
        const rest = toks.slice(i + 1).join(' ');
        if (rest.trim() && rest.trim() !== '-') out.push({ cmd: rest, mode: 'powershell' });
        return out;
      }
      if (isPsParam(tk, 'file', 1)) return out; // scriptTargets reads the file
    }
    return out;
  }

  // `Invoke-Expression "<cmd>"` / `iex '<cmd>'` evaluates its string argument.
  if (base === 'iex' || base === 'invoke-expression') {
    const args = toks.slice(1).filter((x) => !isPsParam(x, 'command', 1));
    if (args.length) out.push({ cmd: args.join(' '), mode: 'powershell' });
    return out;
  }

  // `Start-Process -FilePath cmd -ArgumentList '/c rd /s /q X'`.
  if (base === 'start-process' || base === 'saps' || (base === 'start' && SHELL_MODE === 'powershell')) {
    let file = null;
    let args = null;
    const pos = [];
    for (let i = 1; i < toks.length; i++) {
      const tk = toks[i];
      if (isPsParam(tk, 'filepath', 1)) { file = toks[++i]; continue; }
      if (isPsParam(tk, 'argumentlist', 1) || /^-args$/i.test(tk)) { args = toks[++i]; continue; }
      if (/^-/.test(tk)) {
        if (/^-(verb|workingdirectory|wo|windowstyle|win|credential|cred|redirectstandard\w*|rso|rse|rsi)$/i.test(tk)) i++;
        continue;
      }
      pos.push(tk);
    }
    if (!file) file = pos.shift();
    if (args == null && pos.length) args = pos.join(' ');
    if (file) out.push({ cmd: (file + ' ' + String(args || '').replace(/,/g, ' ')).trim(), mode: 'bash' });
    return out;
  }

  if (base === 'xargs') {
    let t = toks.slice(1);
    while (t.length && t[0].startsWith('-')) {
      if (/^-(I|i|n|P|d|a|s|E|L)$/.test(t[0])) { t = t.slice(2); continue; }
      t = t.slice(1);
    }
    if (t.length) out.push({ cmd: t.join(' '), mode: 'bash' });
    return out;
  }

  if (base === 'find') {
    // Only an UNFILTERED find is treated as acting on its search root. With a
    // `-name` filter, `{}` is the matched file, so substituting the root would
    // read `find . -name '*.tmp' -exec rm -rf {} +` as deleting the whole tree.
    if (findIsScoped(toks)) return out;
    for (let i = 1; i < toks.length; i++) {
      if (toks[i] === '-exec' || toks[i] === '-execdir' || toks[i] === '-ok') {
        const end = toks.findIndex((x, j) => j > i && (x === ';' || x === '+' || x === '\\;'));
        const argv = toks.slice(i + 1, end < 0 ? toks.length : end)
          .map((x) => (x === '{}' ? (findPathArgs(toks)[0] || '{}') : x));
        if (argv.length) out.push({ cmd: argv.join(' '), mode: 'bash' });
        i = end < 0 ? toks.length : end;
      }
    }
  }
  return out;
}

// A `find` with a name/path/regex filter is a scoped cleanup
// (`find . -name '*.pyc' -delete`); one without is a tree wipe
// (`find <repo> -delete`). Only the second is worth blocking -- treating both
// the same would deny an extremely common cleanup, which is the false-positive
// class the 2026-08-10 corpus says does the real damage.
function findIsScoped(toks) {
  return toks.some((t) => /^-(i?name|i?path|i?wholename|i?regex|i?lname)$/.test(t));
}

// The paths `find` was pointed at, i.e. what `-delete` would actually remove.
function findPathArgs(toks) {
  const out = [];
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t.startsWith('-') || t.startsWith('(')) break;
    out.push(t);
  }
  return out.length ? out : ['.'];
}

function isRecursiveFlag(tok, family) {
  if (!tok.startsWith('-')) return false;
  const low = tok.toLowerCase();
  if (family === 'unix') {
    if (low === '--recursive') return true;
    if (low.startsWith('--')) return false;
    return /^-[rfvidI]+$/i.test(tok) && /r/i.test(tok);
  }
  // Any unambiguous prefix of -Recurse (-r, -re, -rec, ... -Recurse), with an
  // optional `:$true`. `-Recurse:$false` is explicitly NOT recursive.
  return /^-r(e(c(u(r(se?)?)?)?)?)?(:\$true)?$/i.test(low);
}

// PowerShell parameters that take a value, so the next token is not a target.
// Matched by unambiguous prefix (3+ letters) like PowerShell itself does, plus
// the common-parameter aliases (`-ea 0`, `-ev err`).
const PS_VALUE_WORDS = [
  'erroraction', 'warningaction', 'informationaction', 'errorvariable',
  'warningvariable', 'informationvariable', 'outvariable', 'outbuffer',
  'pipelinevariable', 'include', 'exclude', 'filter', 'stream', 'credential',
];
const PS_VALUE_ALIASES = new Set(['-ea', '-wa', '-infa', '-ev', '-wv', '-iv', '-ov', '-ob', '-pv']);
const PS_VALUE_PARAMS = {
  has(low) {
    if (PS_VALUE_ALIASES.has(low)) return true;
    const w = low.replace(/^-/, '');
    return w.length >= 3 && PS_VALUE_WORDS.some((x) => x.startsWith(w));
  },
};
// -Path / -LiteralPath / -PSPath name the target itself.
function isPsPathParam(low) {
  const w = low.replace(/^-/, '');
  return w === 'lp' || w === 'pspath' || (w.length >= 2 && ('path'.startsWith(w) || 'literalpath'.startsWith(w)));
}

function stripRedirections(toks) {
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\d*(>>?|<)$/.test(t)) { i++; continue; }
    if (/^\d*(>>?|<)\S+$/.test(t)) continue;
    if (/^\d*>&\d*$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

const DISPOSABLE_BASENAMES = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo',
  '.parcel-cache', 'target',
  // Added 2026-08-16 from the prompt-volume review: every one of these is
  // regenerated by a single command, and asking before deleting one has never
  // saved anything.
  '.venv', 'venv', '.tox', '.gradle', '.svelte-kit', '.astro', '.vite',
  '.output', '.eslintcache', '.nyc_output', '.sass-cache',
]);

// `..` must be collapsed BEFORE any safe-zone test. Without this,
// `/home/me/.cache/../projects/harness-improvements` matched the
// `/\/(scratchpad|\.cache)\//` safe-zone rule and was allowed -- the guard was
// pattern-matching a string that does not name the directory it deletes.
function normalise(p) {
  let slashed = String(p).replace(/\\/g, '/');
  // Git Bash and Cygwin spell `C:\` as `/c/`; both must hit the same rules.
  if (IS_WIN) slashed = slashed.replace(/^\/(?:cygdrive\/)?([a-zA-Z])(?=\/|$)/, '$1:');
  const collapsed = path.posix.normalize(slashed);
  return collapsed.replace(/\/+$/, '').toLowerCase() || (slashed.startsWith('/') ? '/' : '');
}

function disposableRoots() {
  const roots = [];
  for (const v of [process.env.TEMP, process.env.TMP, process.env.TMPDIR, os.tmpdir()]) {
    if (v) roots.push(normalise(v));
  }
  roots.push('/tmp', 'c:/tmp');
  if (IS_WIN) roots.push('c:/windows/temp');
  return roots;
}

// Most real deletes name the target through a variable assigned two lines
// earlier in the same command (`SCRATCH="/tmp/.../scratchpad"; rm -rf "$SCRATCH"`).
// Refusing to resolve those was the single largest false-positive class in the
// corpus replay -- 20+ blocked cleanups of the session's own scratch directory.
function assignmentMap(cmd) {
  const map = new Map();
  let m;
  const posix = /(^|[\s;&|\n])([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s;&|]+))/g;
  while ((m = posix.exec(cmd)) !== null) {
    map.set(m[2], m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : (m[5] || ''));
  }
  const ps = /\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  while ((m = ps.exec(cmd)) !== null) {
    map.set(m[1], m[2] !== undefined ? m[2] : (m[3] || ''));
    // PowerShell variable names are case-insensitive.
    map.set('ps:' + m[1].toLowerCase(), m[2] !== undefined ? m[2] : (m[3] || ''));
  }
  return map;
}

function expandTarget(target, map) {
  let out = String(target);
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/\$\{?env:([A-Za-z_][A-Za-z0-9_]*)\}?/gi, (w, n) => envLookup(n) || w)
      .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (w, n) => envLookup(n) || w)
      .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (w, n) => {
        if (map && map.has(n)) return map.get(n);
        if (map && map.has('ps:' + n.toLowerCase())) return map.get('ps:' + n.toLowerCase());
        // `$_` is PowerShell's pipeline item, not the environment's `_`.
        if (n === '_') return w;
        const e = envLookup(n);
        if (e) return e;
        return w;
      })
      .replace(/^~(?=[\/\\]|$)/, HOME || '~');
    if (next === out) break;
    out = next;
  }
  return out;
}

// --- session provenance (2026-08-16) ----------------------------------------
//
// The dominant false-positive class, by a wide margin. Of 64 guard prompts
// between 2026-08-10 and 2026-08-16, 43 were "recursive delete of X, not a
// temp, scratch or build directory" -- and every single X was a throwaway the
// agent itself had made minutes earlier: `s2`..`s8`, `L1`..`L5`, `op`, `mov`,
// `fin`, `abl`, `winframes`, `fakehome`, `cleaninstall`, `styleref`,
// `ops/.tmpcheck`, `evals/results/*-probe`, `src-tauri/target-lint`.
//
// The classifier's own Irreversible Local Destruction rule is scoped to "files
// that existed before the session". This guard had no way to check that, so it
// fell back to matching basenames, which cannot tell `dist` from `styleref`.
// Now it checks the thing that actually matters: did this path exist when the
// session started, and does git know about it.
//
// Deliberately conservative. Three independent conditions must ALL hold, and
// any one of them being unknowable means the guard keeps asking:
//   1. session start time is established,
//   2. the path sits under the session's own cwd or a disposable root,
//   3. the path was born after the session started and git does not track it.
// No slack. The session-env directory is created before the agent can run
// anything, so a path the agent made is always strictly later. Slack here would
// only widen the window in which a directory the user made just before starting
// the session reads as the agent's own.
const CLOCK_SLACK_MS = 0;
let SESSION_START_MS = null; // set in main; null means "unknown, keep asking"

function readSessionStart(payload) {
  const home = HOME;
  const candidates = [];
  if (payload && payload.session_id) {
    candidates.push(path.join(home, '.claude', 'session-env', String(payload.session_id)));
  }
  // Subagents get their own session id with no session-env directory, so fall
  // back to the transcript file, which is created when the session opens.
  if (payload && payload.transcript_path) candidates.push(String(payload.transcript_path));
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
      if (born > 0) return born;
    } catch { /* try the next candidate */ }
  }
  return null;
}

function gitTracks(abs) {
  // `git ls-files` lists tracked paths under a directory, so this answers for
  // files and directories alike. A non-repo, a missing git, or any error means
  // "cannot establish", which the caller treats as tracked.
  try {
    const r = spawnSync('git', ['-C', path.dirname(abs), 'ls-files', '--cached', '--', abs],
      { encoding: 'utf8', timeout: 2000 });
    if (r.error || r.status !== 0) return false;
    return String(r.stdout || '').trim().length > 0;
  } catch { return true; }
}

// Glob targets are the reason "the path does not exist, so there is nothing to
// lose" cannot be applied blindly: `rm -rf /home/me/projects/*` names no
// literal path at all. For those, resolve the matches by hand and require every
// one of them to be agent-created.
function globMatches(abs) {
  const base = path.basename(abs);
  const dir = path.dirname(abs);
  if (/[*?[\]]/.test(dir)) return null; // a glob in the directory part: too much to resolve
  const re = new RegExp('^' + base
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]') + '$');
  try {
    return fs.readdirSync(dir).filter((e) => re.test(e)).map((e) => path.join(dir, e));
  } catch { return null; }
}

function bornThisSession(abs) {
  let st;
  try { st = fs.lstatSync(abs); } catch { return null; } // caller decides
  const born = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
  return born >= SESSION_START_MS - CLOCK_SLACK_MS;
}

function isAgentCreated(abs, cwd) {
  if (SESSION_START_MS === null) return false;
  if (!abs || !path.isAbsolute(abs)) return false;
  // A variable the guard could not resolve (`$d` from a loop, `$_` in a
  // pipeline, `%X%`) names an unknown path. Resolving it literally produced a
  // path that does not exist, which the "nothing there" branch below then
  // allowed -- an unknowable target read as an empty one. Unknown means ask.
  if (/\$|`|%[A-Za-z_][A-Za-z0-9_]*%/.test(abs)) return false;
  const n = normalise(abs);
  if (!n || n === '/' || n === '~' || /^[a-z]:$/.test(n)) return false;
  // The standing exclusions hold regardless of when the path was created.
  if (/\.worktrees?\//.test(n) || /\/\.git$/.test(n)) return false;
  if (/\/\.claude(\/|$)/.test(n) || /\/\.codex(\/|$)/.test(n)) return false;
  const home = normalise(HOME || '/home/nobody');
  if (n === home) return false;

  // Condition 2: inside the session's own working tree, or a disposable root.
  // A brand-new directory somewhere else on the machine is still not this
  // session's business to delete without asking.
  const inScope = (cwd && (n === normalise(cwd) || n.startsWith(normalise(cwd) + '/'))) ||
    disposableRoots().some((r) => r && n.startsWith(r + '/'));
  if (!inScope) return false;

  if (/[*?[\]]/.test(abs)) {
    const matches = globMatches(abs);
    if (!matches || !matches.length) return false;
    return matches.every((m) => bornThisSession(m) === true && !gitTracks(m));
  }

  const born = bornThisSession(abs);
  // Nothing is there. Deleting it cannot lose data, and the in-scope test above
  // already refused the dangerous version of this case.
  if (born === null) return true;
  if (!born) return false;
  return !gitTracks(abs);
}

// A RELATIVE path that runs through a build-output directory (`../out/siren/$S`,
// `dist/assets`) is regenerable even when its last part is a variable: render
// and build scripts clear their own output this way, and that was gated as
// one-way. Relative only, so an absolute `C:\x\out\...` is still judged on
// its own merits.
function insideBuildOutput(raw) {
  const s = String(raw).replace(/\\/g, '/');
  if (s.startsWith('/') || s.startsWith('~') || /^[A-Za-z]:/.test(s)) return false;
  const parts = s.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (/[$%`]/.test(p)) return false;
    if (p !== 'node_modules' && DISPOSABLE_BASENAMES.has(p.toLowerCase())) return true;
  }
  return false;
}

// rsync/scp remote spec: `host:path`, `user@host:path`, `$HOST:$DIR`, `host::module`.
// A colon before any slash means remote; `C:\x` and `C:/x` are Windows drives.
function isRemoteSpec(p) {
  const s = String(p || '');
  if (/^[A-Za-z]:[\\/]/.test(s)) return false;
  return /::/.test(s) || /^[^/\\]+:/.test(s);
}

function isDisposableTarget(raw) {
  if (!raw) return false;
  if (insideBuildOutput(raw)) return true;
  if (/[$%]/.test(raw) && !/^%temp%/i.test(raw) && !/^\$env:temp/i.test(raw)) {
    if (!/temp|tmp|scratch/i.test(raw)) return false;
  }
  const n = normalise(raw);
  if (!n || n === '/' || n === '.' || n === '..' || n === '~' || /^[a-z]:$/.test(n)) return false;

  // Never disposable: a git worktree checkout (guide rule, incident 2026-06-15
  // -- use `git worktree remove`), or the agent's own state and transcripts.
  if (/\.worktrees?\//.test(n) || /\/\.git$/.test(n)) return false;
  if (/\/\.claude(\/|$)/.test(n) || /\/\.codex(\/|$)/.test(n)) return false;

  const base = path.basename(n);
  // `target` is Rust build output next to a Cargo.toml, and a source directory
  // everywhere else. Treating it as disposable by name alone allowed
  // `rm -rf <repo>/target` in a non-Rust project.
  // `target-lint` / `target-win` are the same build output under a
  // CARGO_TARGET_DIR override, and were prompting for the same wrong reason.
  if (/^target(-[\w.]+)?$/.test(base)) {
    try {
      if (!fs.existsSync(path.join(path.dirname(toNative(n)), 'Cargo.toml'))) return false;
    } catch { return false; }
    return true;
  }
  if (DISPOSABLE_BASENAMES.has(base)) return true;
  // `scratchpad` was unanchored, so a real project named `my-scratchpad-repo`
  // was classified as scratch.
  if (/^tmp[-_.]|^temp[-_.]|[-_.]tmp$|^scratchpad$|^scratchpad[-_.]|[-_.]scratchpad$/.test(base)) return true;

  for (const r of disposableRoots()) {
    if (r && n.startsWith(r + '/')) return true;
  }
  if (/\/(scratchpad|\.cache)\//.test(n)) return true;
  return false;
}

// --- Q3: actions that remove the ability to check the work ------------------

// KEY_LEFTCTRL 29, KEY_RIGHTCTRL 97, KEY_LEFTALT 56, KEY_RIGHTALT 100,
// KEY_F1..F10 59-68, KEY_F11 87, KEY_F12 88.
const FKEY_CODES = new Set([59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88]);
const INJECTORS = new Set(['ydotool', 'xdotool', 'wtype', 'dotool', 'ydotoold']);

function isVtSwitch(seg) {
  const flat = seg.toLowerCase()
    .replace(/\bcontrol\b/g, 'ctrl')
    .replace(/\b(left|right)(ctrl|alt|meta)\b/g, '$2')
    // `wtype -M ctrl -M alt -k F12` puts a letter flag between the modifiers,
    // which would otherwise break the adjacency test below.
    .replace(/\s-{1,2}[a-z]\b/g, ' ');
  if (/ctrl[^a-z0-9]{0,4}alt[^a-z0-9]{0,4}f(1[0-2]|[1-9])\b/.test(flat)) return true;
  if (/alt[^a-z0-9]{0,4}ctrl[^a-z0-9]{0,4}f(1[0-2]|[1-9])\b/.test(flat)) return true;
  // ydotool keycode form: `ydotool key 29:1 56:1 60:1 60:0 56:0 29:0`
  const pressed = new Set();
  let m;
  const re = /\b(\d{1,3}):1\b/g;
  while ((m = re.exec(seg)) !== null) pressed.add(Number(m[1]));
  const ctrl = pressed.has(29) || pressed.has(97);
  const alt = pressed.has(56) || pressed.has(100);
  if (ctrl && alt) {
    for (const c of pressed) if (FKEY_CODES.has(c)) return true;
  }
  return false;
}

function checkObserverLoss(toks, seg) {
  // Everything below names Linux desktop/systemd/netfilter binaries. On Windows
  // they do not exist; the Windows equivalents live in checkWindowsSystem.
  if (!linuxRulesOn(toks)) return null;
  const base = baseOf(toks[0]);
  const rest = toks.slice(1).map((t) => t.toLowerCase());
  const all = rest.join(' ');

  if (INJECTORS.has(base) && isVtSwitch(seg)) {
    return DENY('Refusing to inject Ctrl+Alt+F1-F12: that is `switch-to-session` in mutter. ' +
      'It throws the desktop onto a VT login screen, the machine looks frozen, and nothing can be ' +
      'observed afterwards (incident 2026-08-08). Key injection cannot test a compositor keybinding ' +
      'at all -- only a human press can.');
  }
  if (base === 'chvt') {
    return DENY('`chvt` switches virtual terminal and takes the desktop away from the user. Blocked (Q3: removes the ability to observe).');
  }

  if (base === 'systemctl' || base === 'service') {
    const words = rest.filter((t) => !t.startsWith('-'));
    const verb = words[0] || '';
    // Match the unit EXACTLY. Substring matching denied
    // `systemctl disable NetworkManager-wait-online.service`, which is a boot
    // ordering unit and does not touch the network at all.
    const CRITICAL_UNITS = new Set([
      'gdm', 'gdm3', 'display-manager', 'lightdm', 'sddm', 'gnome-shell',
      'networkmanager', 'systemd-networkd', 'ssh', 'sshd', 'wpa_supplicant',
    ]);
    const hitsCritical = words.slice(1).some((u) => CRITICAL_UNITS.has(u.replace(/\.(service|target|socket)$/, '')));
    if (/^(stop|disable|mask|kill|isolate)$/.test(verb) && hitsCritical) {
      return 'Stopping or masking the display manager or the network stack ends this session or cuts the ' +
        'connection, so nothing after it can be verified. Blocked (Q3). Ask the user if it is genuinely needed.';
    }
    // Was `.test(target)` -- an undefined name, so this branch threw a
    // ReferenceError and only the fail-closed catch in main saved it.
    if (verb === 'isolate' && /\b(rescue|emergency|multi-user)/.test(all)) {
      return '`systemctl isolate` to a non-graphical target tears down the desktop session. Blocked (Q3).';
    }
  }

  if ((base === 'pkill' || base === 'killall') &&
      /\b(gnome-shell|gdm3?|xwayland|mutter|gnome-session|systemd)\b/.test(all)) {
    return 'Killing the compositor or session manager ends the desktop and every unsaved thing in it. Blocked (Q3).';
  }
  if (base === 'loginctl' && /^(terminate-session|terminate-user|kill-session|kill-user)$/.test(rest[0] || '')) {
    return 'Terminating the login session ends this session. Blocked (Q3).';
  }

  // Network lockout. `ufw`/`iptables` rule changes and taking a link down can
  // strand a remote session and cut the agent off mid-task.
  if (base === 'ufw' && /^(enable|disable|reset|default|deny)/.test(rest[0] || '')) {
    return 'Firewall rule changes can lock this machine out of the network mid-task. Blocked (Q3) -- ask the user.';
  }
  if ((base === 'iptables' || base === 'ip6tables' || base === 'nft') &&
      /(-f\b|--flush|-p\s+\w+\s+drop|policy\s+\w+\s+drop)/.test(all)) {
    return 'Flushing firewall rules or setting a DROP policy can strand the machine. Blocked (Q3) -- ask the user.';
  }
  if (base === 'nmcli' && /\b(off|down)\b/.test(all) && /\b(networking|radio|device|con|connection)\b/.test(all)) {
    return 'Taking networking down cuts this session off from everything it needs to verify. Blocked (Q3).';
  }
  if (base === 'ip' && /^link$/.test(rest[0] || '') && /\bdown\b/.test(all)) {
    return 'Taking a network link down cuts this session off. Blocked (Q3).';
  }

  // Destroying the record of what happened.
  if (base === 'journalctl' && /--vacuum|--rotate/.test(all)) {
    return 'Vacuuming the journal destroys the log of what just happened. Blocked (Q3).';
  }

  return null;
}

// Self-privilege: changing the rules the agent runs under, through the shell
// (the Edit/Write channel stays with the classifier, which judges intent).
// Case-insensitive since the Windows port: NTFS treats `.Claude\Settings.json`
// as the same file.
const SELF_PRIVILEGE_PATHS = /(^|\/)\.claude\/(settings\.json|settings\.local\.json|hooks\/|CLAUDE\.md)|(^|\/)\.claude\.json$/i;
// Split by mutator class, not by path. H-105 (2026-08-11): in auto mode a hook
// ASK verdict is adjudicated by the classifier, not by the user -- and the
// classifier approved `python3 -c "...json.dump(settings.json)"` while refusing
// the identical change through the Edit tool. So for this rule ASK is not the
// safe default it is elsewhere: it hands the decision back to the layer that
// already got it wrong, and under bypassPermissions it collapses to allow.
//
// HARD rewrites a config file in place through an interpreter or stream editor.
// A reasonable answer is never yes: there is no legitimate reason to mutate
// settings.json or the guard itself from inside a one-liner rather than through
// Edit/Write, where the diff is visible before it lands. Terminal.
const HARD_MUTATORS = new Set([
  'sed', 'tee', 'dd', 'truncate', 'python', 'python3', 'node', 'perl', 'jq',
  'sponge', 'patch',
  // PowerShell content writers (Windows port). `tee` above is Tee-Object there.
  'set-content', 'add-content', 'out-file', 'clear-content', 'ac', 'tee-object',
]);
// SOFT moves a whole file that already exists somewhere reviewable. A
// reasonable answer is routinely yes -- `cp settings.json.bak-x settings.json`
// restores a backup and INCREASES safety, and copying a reviewed hook into
// `~/.claude/hooks/` is how a deploy works. Stays on ASK.
const SOFT_MUTATORS = new Set([
  'install', 'mv', 'cp', 'ln', 'chmod', 'chown',
  // PowerShell/cmd whole-file movers and ACL tools (Windows port).
  'copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move', 'rename-item', 'ren', 'rni',
  'new-item', 'ni', 'icacls', 'takeown', 'xcopy', 'robocopy',
  // Deleting the guard or settings.json is as much a rule change as rewriting
  // it, and recursive-only coverage left `rm ~/.claude/hooks/guard-irreversible.js`
  // ungated on both platforms.
  'rm', 'remove-item', 'ri', 'del', 'erase', 'unlink',
]);
const PS_COPY_MOVE = new Set(['copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move', 'xcopy']);
// The canonical source tree the harness is deployed FROM. Anchored on the
// `managed/claude/` segment rather than an absolute path so a checkout in
// another directory still matches.
const MANAGED_SOURCE = /(^|\/)managed\/claude\//;
const MUTATORS = new Set([...HARD_MUTATORS, ...SOFT_MUTATORS]);

function selfPrivilegeWhy() {
  return 'This rewrites the agent\'s own permissions, hooks or guide through the shell -- a ' +
    'self-privilege change (Q3), and it is the one mistake that compounds: every later action runs ' +
    'under the rules it just changed. ';
}

function checkSelfPrivilege(toks, seg) {
  const base = baseOf(toks[0]);
  const slashedSeg = seg.replace(/\\/g, '/');
  if (!SELF_PRIVILEGE_PATHS.test(slashedSeg)) return null;
  // A shell redirection over the file (`echo {} > ~/.claude/settings.json`,
  // PowerShell `*>`) is the same in-place rewrite as `tee`, whatever the head.
  for (let i = 0; i < toks.length; i++) {
    const m = /^(?:\d|\*)?>>?(.*)$/.exec(toks[i]);
    if (!m) continue;
    const dest = m[1] || toks[i + 1] || '';
    if (SELF_PRIVILEGE_PATHS.test(dest.replace(/\\/g, '/'))) {
      return DENY(selfPrivilegeWhy() + 'Rewriting a config file in place by redirection is never the right tool. ' +
        'Use the Edit or Write tool, where the diff is visible before it lands.');
    }
  }
  // .NET file APIs from PowerShell: `[IO.File]::WriteAllText('...settings.json', ...)`.
  if (/\[(system\.)?io\.file\]::(write|append|delete|copy|move|replace|create)/i.test(seg)) {
    return DENY(selfPrivilegeWhy() + 'Rewriting a config file from a .NET one-liner is never the right tool. ' +
      'Use the Edit or Write tool, where the diff is visible before it lands.');
  }
  if (!MUTATORS.has(base)) return null;
  // Hook scripts used to be excluded here: a terminal block would have wedged
  // ordinary work on the user's own hook projects (7 such commands in the corpus,
  // all legitimate). With the ASK tier that reasoning no longer holds -- they see
  // the reason and approves -- so `~/.claude/hooks/` is now gated too. This is
  // the layer that matters most while the bwrap sandbox stays off: without it,
  // nothing else stops a shell command from rewriting the guard that is
  // supposed to be watching.
  // `sed -n` and a bare read are not mutations.
  if (base === 'sed' && !/\s-[a-z]*i\b|--in-place/.test(seg)) return null;
  // `jq` has no in-place mode. It only mutates when its output is redirected
  // back over the file or piped through sponge. Without this, the read
  // `jq '.permissions' ~/.claude/settings.json` was denied as self-privilege --
  // observed live on 2026-08-10, and a direct contradiction of the classifier's
  // own "NEVER BLOCK reads" rule.
  if (base === 'jq' && !/>\s*\S*settings(\.local)?\.json|\.claude\.json\s*$|\bsponge\b/.test(seg)) return null;
  if ((base === 'python' || base === 'python3' || base === 'node' || base === 'perl') &&
      !/\bopen\s*\([^)]*['"][wa]|writeFileSync|writeFile/.test(seg)) return null;
  if (base === 'cp' || base === 'mv' || base === 'install' || PS_COPY_MOVE.has(base)) {
    // Copying settings OUT to a backup is not a privilege change.
    const rest = stripRedirections(toks.slice(1)).filter((t) => !t.startsWith('-'));
    const dest = rest[rest.length - 1] || '';
    if (!SELF_PRIVILEGE_PATHS.test(dest.replace(/\\/g, '/')) || /\.bak|backup/i.test(dest)) return null;
    // A deploy out of the managed source tree is the documented way this
    // machine's harness is changed: the file was reviewed and committed in the
    // repo first, and the diff is `git -C ~/.claude diff` afterwards. Gating it
    // meant a prompt on every single deploy, which is where most of the
    // self-privilege prompts in the 2026-08-16 review came from.
    if (rest.slice(0, -1).some((s) => MANAGED_SOURCE.test(s.replace(/\\/g, '/')))) return null;
  }
  const why = selfPrivilegeWhy();
  if (HARD_MUTATORS.has(base)) {
    return DENY(why + 'Rewriting a config file in place from a one-liner is never the right tool. ' +
      'Use the Edit or Write tool, where the diff is visible before it lands.');
  }
  return why + 'Approve if you asked for it, and expect a plain-English before/after afterwards. ' +
    'Prefer the Edit tool: the diff is visible before it lands, where a shell rewrite is not.';
}

// --- Q1: loss of something that cannot be regenerated -----------------------

// Directories a recursive ownership/ACL sweep must never cover. Normalised
// (lowercase, forward slashes, `/c/` -> `c:/` on Windows) before the test.
function isSystemRoot(n) {
  if (n === '/' || n === '~' || n === '/home' || /^\/(etc|usr|var|boot|opt|srv)(\/|$)/.test(n) ||
      /^\/home\/[^/]+$/.test(n)) return true;
  if (/^[a-z]:\/?$/.test(n)) return true;
  if (/^[a-z]:\/(windows|program files|program files \(x86\)|programdata|recovery|boot)(\/|$)/.test(n)) return true;
  if (/^[a-z]:\/users(\/[^/]+)?$/.test(n)) return true;
  return !!HOME && n === normalise(HOME);
}

function checkUnrecoverable(toks, seg) {
  const base = baseOf(toks[0]);
  const rest = toks.slice(1).map((t) => t.toLowerCase());
  const all = rest.join(' ');

  if (base === 'mkfs' || /^mkfs\./.test(base) || base === 'wipefs' || base === 'shred') {
    return '`' + base + '` destroys a filesystem or a file beyond recovery. Blocked (Q1) -- ask the user.';
  }
  // Git Bash maps /dev/sdX to physical disks; `\\.\PhysicalDrive0` is the
  // native spelling of the same thing.
  if (base === 'dd' && /\bof=(\/dev\/|\\\\\.\\|\/\/\.\/)/.test(all)) {
    return '`dd` writing to a block device overwrites the disk. Blocked (Q1) -- ask the user.';
  }
  if ((base === 'parted' || base === 'fdisk' || base === 'sfdisk' || base === 'sgdisk') &&
      !/-l\b|--list|\bprint\b|\bunit\b|--dump|--backup/.test(all)) {
    return 'Partition table edits are not recoverable from here. Blocked (Q1) -- ask the user.';
  }
  if (base === 'timeshift' && /--delete/.test(all)) {
    return 'Deleting a Timeshift snapshot removes the machine\'s rollback point -- the thing that makes ' +
      'everything else recoverable. Blocked (Q1).';
  }
  if (base === 'btrfs' && /subvolume\s+delete/.test(all)) {
    return 'Deleting a btrfs subvolume can remove a snapshot. Blocked (Q1) -- ask the user.';
  }
  if (base === 'zfs' && rest[0] === 'destroy') {
    return '`zfs destroy` is not recoverable. Blocked (Q1) -- ask the user.';
  }
  // Package removal on a machine whose rebuild is itself a project.
  if ((base === 'apt' || base === 'apt-get' || base === 'aptitude') &&
      /^(remove|purge|autoremove)$/.test(rest.find((t) => !t.startsWith('-')) || '')) {
    return 'Removing packages can take out something another tool depends on and is awkward to undo. ' +
      'Blocked -- ask the user, or install alongside instead.';
  }
  if (base === 'dpkg' && /(^|\s)(-r|-P|--remove|--purge)(\s|$)/.test(' ' + all)) {
    return 'Removing packages with dpkg skips dependency checks. Blocked -- ask the user.';
  }
  // Kernel modules: ec_sys write_support exposes raw embedded-controller
  // writes, which can leave the machine in a state a reboot does not clear.
  if (base === 'modprobe' || base === 'insmod' || base === 'rmmod') {
    return 'Loading or unloading a kernel module reaches below anything this session can undo ' +
      '(ec_sys write_support can leave the embedded controller in a bad state). Blocked (Q1) -- ask the user.';
  }
  // Raw writes into kernel interfaces.
  if ((base === 'tee' || base === 'dd') && /\s\/(sys|proc)\//.test(seg)) {
    return 'Writing directly into /sys or /proc changes hardware or kernel behaviour with no undo record. ' +
      'Blocked (Q1) -- ask the user.';
  }
  // Ownership/permission sweeps above a project root.
  if ((base === 'chown' || base === 'chmod') && rest.some((t) => /^-[a-z]*r/i.test(t) || t === '--recursive')) {
    const targets = stripRedirections(toks.slice(1)).filter((t) => !t.startsWith('-'));
    const bad = targets.filter((t) => {
      // normalise() strips trailing slashes, which turns "/" into "".
      const n = normalise(t) || '/';
      return isSystemRoot(n);
    });
    if (bad.length) {
      return 'Recursive ownership or permission changes over ' + bad.map((t) => '`' + t + '`').join(', ') +
        ' are effectively irreversible without a full reinstall. Blocked (Q1).';
    }
  }
  return null;
}

// --- Q2: reaching past this machine -----------------------------------------

const PASTE_HOSTS = /\b(pastebin\.com|hastebin|ix\.io|0x0\.st|transfer\.sh|file\.io|termbin|bashupload|gofile\.io|anonfiles|dpaste|sprunge\.us)\b/i;
const CREDENTIAL_FILE = /(^|[\/\\.])(\.env(\.|$|["'\s])|credentials?\.json|\.pem\b|\.p12\b|\.pfx\b|id_[rd]sa|id_ed25519|\.npmrc\b|\.netrc\b|\.pgpass\b|\.aws\/|\.ssh\/|\.kube\/config|service[-_]?account[^\/\s]*\.json)/i;

// Reading a credential STORE into the transcript. This replaces the five
// `permissions.deny` Read() rules (~/.ssh/**, ~/.aws/**, ~/.gnupg/**,
// ~/.kube/config, ~/.claude/.credentials.json) removed on 2026-09-03 (H-186):
// Claude Code 2.1.259 turns ANY configured Read() deny rule into a permission
// prompt on every `cd DIR && grep FILE` whose directory it declines to resolve,
// which is the shape every mission leg writes, so leg 2 sat parked for six
// hours on a grep. The rules' intent lives here instead, deterministically and
// as ASK: a command that would print the contents of one of those stores.
// Listing, permission changes and the tools that legitimately consume the
// store (ssh, kubectl, git, gpg, aws, az) pass; only reading the VALUE asks.
// Tested against the segment with backslashes turned into slashes. The Windows
// home spellings (`C:\Users\x`, `/c/Users/x`, `$env:USERPROFILE`, `%USERPROFILE%`)
// were added in the Windows port; PowerShell's `$HOME` is case-insensitive.
const CREDENTIAL_STORE = /(~|\$HOME|\$\{HOME\}|\$env:(USERPROFILE|HOME)|\$\{env:(USERPROFILE|HOME)\}|%USERPROFILE%|%HOMEDRIVE%%HOMEPATH%|\/home\/[^/\s"']+|\/root|(?:\b[a-z]:|\/[a-z]|\/cygdrive\/[a-z])\/users\/[^/\s"']+)\/(\.ssh\/|\.aws\/|\.gnupg\/|\.kube\/config(\b|$)|\.claude\/\.credentials\.json(\b|$))/i;
const STORE_CONSUMERS = new Set([
  'ls', 'stat', 'file', 'test', '[', 'chmod', 'chown', 'mkdir', 'touch', 'du', 'find', 'tree',
  'ssh', 'ssh-add', 'ssh-keygen', 'ssh-copy-id', 'ssh-agent', 'sftp', 'gpg', 'gpg2', 'gpgconf',
  'kubectl', 'helm', 'k9s', 'az', 'aws', 'git', 'rsync', 'scp',
  // PowerShell / Windows equivalents of listing, metadata and ACL fixes.
  'get-childitem', 'gci', 'dir', 'test-path', 'get-item', 'gi', 'get-acl', 'set-acl', 'icacls',
  'new-item', 'ni', 'resolve-path', 'rvpa', 'split-path', 'join-path',
]);

// Commands that only handle the PATH string, never the file's contents.
const PATH_ONLY = new Set(['for', 'echo', 'printf', 'realpath', 'readlink', 'basename', 'dirname', '[[', 'write-output', 'write-host']);
// Files in those stores that hold no secret: a public key is meant to be
// shared (5 prompts in 10 days were `cat ~/.ssh/id_ed25519.pub` in a setup
// script that prints it for pasting into a server panel).
const NOT_SECRET = /\.pub\b|\/known_hosts\b|\.ssh\/config\b/;

function checkCredentialRead(toks, seg) {
  const fseg = seg.replace(/\\/g, '/');
  if (!CREDENTIAL_STORE.test(fseg)) return null;
  const base = baseOf(toks[0]);
  if (STORE_CONSUMERS.has(base) || PATH_ONLY.has(base)) return null;
  // Key tools called through a helper (`run_cmd "Create a key" ssh-keygen ...`)
  // write or use the key; they never print the private half.
  if (toks.slice(1).some((t) => /^(ssh-keygen|ssh-add|ssh-copy-id)(\.exe)?$/.test(baseOf(t)))) return null;
  const hits = fseg.match(new RegExp(CREDENTIAL_STORE.source + '[^\\s"\')]*', 'g')) || [];
  if (hits.length && hits.every((h) => NOT_SECRET.test(h))) return null;
  return 'Reading a credential store (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.kube/config`, ' +
    '`~/.claude/.credentials.json`) prints a secret VALUE into the transcript, which is egress once ' +
    'the transcript syncs. Blocked (Q2). Check existence with `test -f`, `ls` or `Test-Path`, or use ' +
    'the key through ssh/kubectl/gpg; those pass without a block.';
}

const PS_WEB = new Set(['iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod']);

function checkEgress(toks, seg) {
  const base = baseOf(toks[0]);
  const all = toks.slice(1).join(' ');

  // PowerShell's HTTP cmdlets: same two tiers as curl.
  if (PS_WEB.has(base)) {
    if (PASTE_HOSTS.test(seg)) {
      return 'Uploading to a public paste or file-drop service sends local data somewhere it cannot be ' +
        'recalled. Blocked (Q2) -- if this is deliberate, the user should name the destination.';
    }
    const upload = /(^|\s)-(inf(i(le?)?)?|bo(dy?)?|fo(rm?)?)(\s|:|$)/i.test(' ' + all);
    if (upload && CREDENTIAL_FILE.test(all)) {
      return DENY('Uploading a credential file to a remote host. Blocked (Q2) -- a leaked secret cannot be unsent, ' +
        'only rotated.');
    }
  }

  if (base === 'curl' || base === 'wget') {
    if (PASTE_HOSTS.test(seg)) {
      return 'Uploading to a public paste or file-drop service sends local data somewhere it cannot be ' +
        'recalled. Blocked (Q2) -- if this is deliberate, the user should name the destination.';
    }
    const upload = /(^|\s)(-T|--upload-file|-F|--form|-d|--data(-binary|-raw)?)(\s|=)/.test(' ' + all);
    if (upload && CREDENTIAL_FILE.test(all)) {
      return DENY('Uploading a credential file to a remote host. Blocked (Q2) -- a leaked secret cannot be unsent, ' +
        'only rotated.');
    }
  }
  if (base === 'gh' && /^gist\s+create/.test(all)) {
    return 'Creating a gist publishes local content. Blocked (Q2) -- ask the user and name what goes in it.';
  }
  if ((base === 'scp' || base === 'rsync') && CREDENTIAL_FILE.test(all) && /\S+@\S+:|::/.test(all)) {
    return DENY('Copying a credential file to a remote host. Blocked (Q2).');
  }
  return null;
}

// Remote code execution from an untrusted source: `curl ... | bash`. Detected
// on the raw command because the pipe is exactly what splitSegments removes.
function checkPipeToShell(rawCmd) {
  // `curl | bash` executes the download. `curl | python -c "..."` does NOT --
  // it runs LOCAL code with the download as stdin data, which is ordinary work
  // and accounted for 4 of the corpus false positives. The dangerous form is an
  // interpreter with no inline script of its own.
  const re = /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b([^|;\n]{0,400})\|\s*(sudo\s+)?(bash|sh|zsh|dash|ksh|python3?|node|perl|ruby|pwsh|powershell)(\.exe)?\b([^|;\n]*)/i;
  // Pipes inside quotes are text, not pipes: `grep -E "curl|wget|sh"` read as
  // curl piped into sh. Mask them (same length) before matching.
  const masked = maskQuotedPipes(rawCmd);
  const m = re.exec(masked);
  if (m && !/(^|\s)(-c|-e|--eval|--command)(\s|$)/.test(m[6] || '') && !allOfficial(m[2])) {
    return 'Piping a download straight into a shell runs code nobody has read, from a source this session ' +
      'has not verified. Blocked (Q2). Download to the scratchpad, read it, then run it.';
  }
  // The PowerShell spellings of the same thing: `iwr URL | iex`,
  // `iex (irm URL)`, `iex ((New-Object Net.WebClient).DownloadString(URL))`,
  // `& ([scriptblock]::Create((irm URL)))`.
  const DL = '(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloaddata|downloadfile|net\\.webclient|start-bitstransfer)';
  const psm = new RegExp('\\b' + DL + '\\b[^;\\n]{0,400}\\|\\s*(iex|invoke-expression)\\b', 'i').exec(masked) ||
      new RegExp('\\b(iex|invoke-expression)\\b[^;\\n]{0,400}\\b' + DL + '\\b[^;\\n]{0,400}', 'i').exec(masked) ||
      new RegExp('\\[scriptblock\\]::create\\s*\\([^;\\n]{0,400}\\b' + DL + '\\b[^;\\n]{0,400}', 'i').exec(masked);
  if (psm && !allOfficial(psm[0])) {
    return 'Evaluating downloaded text with Invoke-Expression runs code nobody has read, from a source this ' +
      'session has not verified. Blocked (Q2). Download to the scratchpad, read it, then run it.';
  }
  const pip = checkPipUrlInstall(rawCmd);
  if (pip) return pip;
  return null;
}

function maskQuotedPipes(s) {
  let out = '';
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q && s[i - 1] !== '\\' && s[i - 1] !== '`') q = null;
      out += (ch === '|' || ch === ';' || ch === '\n') ? ' ' : ch;
    } else {
      if (ch === '"' || ch === "'") q = ch;
      out += ch;
    }
  }
  return out;
}

// Vendor install scripts, matched on the URL prefix (https only). A vendor's
// own documented installer is what its docs tell a human to paste; gating it
// bought nothing, since every one in the log was approved unread.
const OFFICIAL_INSTALLERS = [
  'https://claude.ai/install', 'https://astral.sh/', 'https://bun.sh/install', 'https://sh.rustup.rs',
  'https://win.rustup.rs/', 'https://get.pnpm.io/', 'https://deno.land/install', 'https://fnm.vercel.app/install',
  'https://raw.githubusercontent.com/nvm-sh/nvm/', 'https://raw.githubusercontent.com/Homebrew/install/',
  'https://get.docker.com', 'https://ollama.com/install', 'https://install.python-poetry.org',
  'https://deb.nodesource.com/', 'https://rpm.nodesource.com/', 'https://starship.rs/install',
  'https://tailscale.com/install', 'https://cli.github.com/', 'https://get.volta.sh',
  'https://opencode.ai/install', 'https://mise.run', 'https://pixi.sh/install', 'https://get.scoop.sh',
  'https://community.chocolatey.org/install.ps1', 'https://aka.ms/install-powershell.ps1',
];
function allOfficial(text) {
  const urls = String(text || '').match(/https:\/\/[^\s'"|)]+/g) || [];
  return urls.length > 0 && urls.every((u) => OFFICIAL_INSTALLERS.some((p) => u.startsWith(p)));
}

// `pip install <url>` runs setup code from wherever the URL points. Only the
// PACKAGE arguments count: `--index-url https://download.pytorch.org/...` is a
// package index, not a package, and was gated 3 times in 10 days for nothing.
// A git ref pinned to a tag or commit, or a versioned release archive, is
// reproducible, which is what the rule was protecting.
function checkPipUrlInstall(rawCmd) {
  const re = /\bpip3?\s+install\b([^\n;&|]*)/gi;
  let m;
  while ((m = re.exec(rawCmd))) {
    const toks = m[1].trim().split(/\s+/);
    const pkgs = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i].replace(/^['"]|['"]$/g, '');
      if (/^(-i|--index-url|--extra-index-url|-f|--find-links|--trusted-host|-c|--constraint|-r|--requirement|--python|-t|--target|--prefix)$/.test(t)) { i++; continue; }
      if (t.startsWith('-')) continue;
      pkgs.push(t);
    }
    for (const p of pkgs) {
      const url = (p.match(/(git\+\S+|https?:\/\/\S+)/) || [])[1];
      if (!url) continue;
      const pinnedGit = /^git\+/.test(url) && /@(v?\d[\w.-]*|[0-9a-f]{7,40})(#|$)/.test(url);
      const releaseFile = /^https:\/\//.test(url) && /[-_]v?\d+(\.\d+)+[^/]*\.(whl|tar\.gz|zip)(#.*)?$/.test(url);
      if (!pinnedGit && !releaseFile) {
        return 'Installing a Python package from an unpinned URL or git ref runs setup code that can change ' +
          'under you. Blocked (Q2) -- pin it: `git+<url>@<tag or commit>`, or a versioned release archive.';
      }
    }
  }
  return null;
}

// --- existing rules ---------------------------------------------------------

// `git -C <path> push --force` put `-C` in toks[1], so the subcommand test saw
// `-c` instead of `push` and every git rule below was skipped. Strip git's own
// global options before reading the subcommand.
function stripGitGlobals(toks) {
  let t = toks.slice(1);
  while (t.length && t[0].startsWith('-')) {
    if (/^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path)$/.test(t[0])) { t = t.slice(2); continue; }
    if (/^(--git-dir|--work-tree|--namespace|--exec-path)=/.test(t[0])) { t = t.slice(1); continue; }
    t = t.slice(1);
  }
  return t;
}

// --- recoverability downgrades ----------------------------------------------
//
// The user runs agents unattended and cannot inspect a risky action while away,
// so a prompt is not protection -- it is a stall. The way out is to make the
// action reversible and then stop gating it. `autosave-git.js` commits the
// tracked AND untracked worktree to refs/harness/autosave/<ts> before any
// destructive git command; when that snapshot is fresh, the commands below stop
// being one-way and are granted outright.
//
// Protection is what buys the autonomy: no marker, no downgrade. If the
// snapshot hook fails, these fall back to ASK on their own.
const RECOVERABLE_GIT = /^(reset|restore|checkout|clean|stash|switch|branch|merge|revert|rebase)$/;
const AUTOSAVE_MAX_AGE_MS = 5 * 60 * 1000;

let AUTOSAVE = null; // set once in main, read by checkGitHistory

function freshAutosave(cwd) {
  try {
    const base = process.env.XDG_RUNTIME_DIR || path.join(os.tmpdir(), `claude-${process.getuid ? process.getuid() : 0}`);
    const dir = path.join(base, 'claude-autosave');
    // The marker is keyed by repo root, which the hook resolved. Match any
    // marker whose repo is a prefix of cwd, so a subdirectory still counts.
    for (const f of fs.readdirSync(dir)) {
      let m;
      try { m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (!m || !m.repo || !m.ref) continue;
      if (Date.now() - (m.at || 0) > AUTOSAVE_MAX_AGE_MS) continue;
      const c = normalise(cwd);
      const r = normalise(m.repo);
      if (c === r || c.startsWith(r + '/')) return m;
    }
  } catch { /* no marker dir yet */ }
  return null;
}

function checkGitHistory(toks) {
  const head = baseOf(toks[0]);
  if (head !== 'git') return null;
  const after = stripGitGlobals(toks);
  const sub = (after[0] || '').toLowerCase();
  const rest = after.slice(1).map((t) => t.toLowerCase());
  const all = rest.join(' ');
  if (sub === 'push' && rest.some((t) => t === '--force' || t === '-f')) {
    return 'Force-push is on the always-block list. Push normally, or ask the user for an explicit approval. ' +
      '(`--force-with-lease` is allowed -- it refuses when the remote moved.)';
  }
  // `git push origin +main` is a force push written as a refspec. Same effect,
  // no `--force` anywhere in the command.
  if (sub === 'push' && rest.some((t) => /^\+[^-\s][^\s]*$/.test(t) && !t.startsWith('+refs/tags/'))) {
    return 'A leading `+` on a refspec forces the push, exactly like `--force`. Blocked -- drop the `+`, ' +
      'or use `--force-with-lease` if the remote really has to be overwritten.';
  }
  // Covered by a fresh worktree snapshot: not one-way any more, so not gated.
  // Force-push, reflog expire, gc --prune and filter-branch are deliberately
  // NOT in this set -- a local snapshot does not undo a rewritten remote or a
  // pruned object database.
  if (AUTOSAVE && RECOVERABLE_GIT.test(sub)) return null;
  if (sub === 'reset' && rest.includes('--hard') && rest.some((t) => t.startsWith('origin/'))) {
    return 'git reset --hard origin/* rewrites your branch to the remote and discards local work. ' +
      'Use a soft reset or a backup branch, or ask the user.';
  }
  if (sub === 'clean' && rest.some((t) => /^-[a-z]*f/i.test(t))) {
    return 'git clean with a force flag permanently deletes untracked files. Review with `git clean -n` first, or ask the user.';
  }
  // The recovery net for everything else in git.
  if (sub === 'reflog' && /expire/.test(all)) {
    return 'Expiring the reflog removes the undo record for every other git operation. Blocked (Q1).';
  }
  if (sub === 'gc' && /--prune=(now|all)/.test(all)) {
    return '`git gc --prune=now` drops unreachable objects immediately, destroying the recovery net. Blocked (Q1).';
  }
  if (sub === 'filter-branch' || sub === 'filter-repo') {
    return 'History rewriting across a whole repo is not recoverable from here. Blocked (Q1) -- ask the user.';
  }
  if (sub === 'update-ref' && rest.includes('-d')) {
    return 'Deleting a ref by hand can orphan commits with no reflog entry. Blocked (Q1).';
  }
  return null;
}

// Split out of checkDelete so the self-cleanup grant below can ask the same
// question ("is this segment a recursive delete, and of what") without
// re-implementing the flag and target parsing that took a corpus replay to get
// right. Returns null when the segment is not a recursive delete.
function recursiveDeleteTargets(toks) {
  const head = (toks[0] || '');
  const base = baseOf(head);
  if (base === 'git') return null; // `git rm` is an index operation

  const isRm = RM_NAMES.has(base);
  const isPs = PS_REMOVE.has(base);
  const isAlways = RECURSIVE_ALWAYS.has(base);
  if (!isRm && !isPs && !isAlways) return null;

  const args = stripRedirections(toks.slice(1));

  // `rm` is GNU rm in Git Bash and Remove-Item in PowerShell, and `ri`/`del`
  // accept `-r`, so every delete head is tested against BOTH flag spellings.
  // A unix-only test read `rm -Recurse X` (valid PowerShell) as non-recursive.
  // cmd.exe's `rd /s` and `del /s` are tree deletes; Git Bash writes `//s`.
  const isCmdish = CMD_TREE_DELETE.has(base);
  const cmdStyleRecursive = isCmdish && args.some((a) => /^\/{1,2}s$/i.test(a));
  const recursive = isAlways || cmdStyleRecursive ||
    args.some((a) => isRecursiveFlag(a, 'unix') || (!isAlways && isRecursiveFlag(a, 'powershell')));
  if (!recursive) return null;

  // Only cmd-style heads take `/x` switches; for `rm` a `/c` is the C: drive in
  // Git Bash and must stay a target.
  const isCmdSwitch = (a) => isCmdish && /^\/{1,2}[a-z](:\S*)?$/i.test(a);
  const targets = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const low = a.toLowerCase().replace(/:.*$/, '');
    if (a.startsWith('-')) {
      // `-Path:C:\x` / `-LiteralPath:'C:\x'` carry the target inside the flag.
      if (a.includes(':') && isPsPathParam(low)) {
        const v = a.slice(a.indexOf(':') + 1);
        if (v) targets.push(v);
        continue;
      }
      if (PS_VALUE_PARAMS.has(low)) i++;
      continue;
    }
    if (isCmdSwitch(a)) continue;
    for (const part of a.split(',')) {
      if (part.trim()) targets.push(part.trim());
    }
  }
  return targets;
}

function checkDelete(toks, varMap, cwd) {
  const targets = recursiveDeleteTargets(toks);
  if (targets === null) return null;
  if (!targets.length) {
    return 'A recursive delete with no resolvable target is blocked by the local guard.';
  }

  const unsafe = targets.filter((t) => {
    const expanded = expandTarget(t, varMap);
    if (isDisposableTarget(expanded)) return false;
    // A relative target inside a temp or scratch working directory is disposable.
    if (cwd && !/^([~/\\$]|[A-Za-z]:)/.test(expanded) && !/[$`%]/.test(expanded) &&
        isDisposableTarget(toAbs(expanded, cwd))) return false;
    // Second chance on provenance: a path this session created, inside its own
    // working tree, that git does not track, is the agent's own leftover.
    const abs = toAbs(expanded, cwd);
    return !isAgentCreated(abs, cwd);
  });
  if (!unsafe.length) return null;

  // safe-rm is a bash script: from PowerShell it has to be run through bash.
  const safeRm = SHELL_MODE === 'powershell' ? 'bash ~/.claude/bin/safe-rm ' : '~/.claude/bin/safe-rm ';
  return 'Recursive delete of ' + unsafe.slice(0, 3).map((t) => '`' + t + '`').join(', ') +
    ' — not a temp, scratch or build directory, so this is one-way. Use the recoverable form, which is ' +
    'never gated and needs no approval:\n' +
    '  ' + safeRm + unsafe[0] + '\n' +
    'It moves the path to a dated graveyard (14-day retention); `safe-rm --list` and ' +
    '`safe-rm --restore <entry>` bring it back. For a worktree use `git worktree remove`.';
}

// --- resource hazards (Q3: a machine that OOMs cannot be observed) ----------

// Earned 2026-08-10: `strings` over the 263 MB Claude binary, piped into a
// backtracking regex, exhausted RAM on this 14 GB machine and the desktop app
// was OOM-killed mid-session. That is a Q3 failure -- the session died, so
// nothing after it could be checked -- and no rule in this guard saw it coming.
//
// Scoped to tools that materialise a whole large file, and only when the target
// really is large, so ordinary use stays untouched. The fix is offered inline,
// because a block without an alternative just gets worked around.
const MEMORY_HAZARD = new Set(['strings', 'objdump', 'nm', 'readelf', 'xxd', 'od', 'hexdump', 'base64']);
const BIG_FILE_BYTES = 50 * 1024 * 1024;

// Since 2.1.233 Claude Code can put every Bash command under a memory cgroup
// (CLAUDE_CODE_TOOL_MEMORY_LIMIT, settings.json -> env). With that on, the
// kernel kills the runaway `strings` instead of the desktop app, which is the
// whole reason this rule exists, so the rule stands down and the command falls
// through to the ordinary allow list. 14 prompts in 30 days, all retried
// anyway, said the ask was not buying anything (H-169). Hooks inherit the
// process env, so the guard sees the same value the Bash tool runs under.
function toolMemoryCapped() {
  // The cap is a Linux memory cgroup. Windows has no equivalent under the Bash
  // or PowerShell tool, so there the variable caps nothing and the gate stays.
  if (!LINUX_RULES) return false;
  const v = String(process.env.CLAUDE_CODE_TOOL_MEMORY_LIMIT || '').trim().toLowerCase();
  return v !== '' && v !== '0' && v !== 'off';
}

function checkResourceHazard(toks, seg, varMap) {
  const base = baseOf(toks[0]);
  if (!MEMORY_HAZARD.has(base)) return null;
  if (toolMemoryCapped()) return null;
  for (const a of stripRedirections(toks.slice(1))) {
    if (a.startsWith('-')) continue;
    let size = 0;
    try {
      const st = fs.statSync(toNative(expandTarget(a, varMap)));
      if (!st.isFile()) continue;
      size = st.size;
    } catch { continue; }
    if (size < BIG_FILE_BYTES) continue;
    const mb = Math.round(size / (1024 * 1024));
    return ASK('`' + base + '` over `' + a + '` (' + mb + ' MB) streams the whole file, and piping that into ' +
      'a regex is how the desktop app got OOM-killed on 2026-08-10. Run it under a ceiling instead:\n' +
      '  ~/.claude/bin/agent-run ' + base + ' ' + a + ' | ...\n' +
      'or bound it directly (`head -c`, a fixed `-n`, a narrower pattern). Approve only if you want it uncapped.');
  }
  return null;
}

// Deletion that never spells `rm`. Both of these were confirmed bypasses:
// `find <repo> -delete` and `rsync -a --delete /empty/ <repo>/` empty a
// directory tree just as thoroughly, and neither has `rm` anywhere in it.
function checkBulkDelete(toks, seg, varMap) {
  const base = baseOf(toks[0]);

  if (base === 'find' && toks.some((t) => t === '-delete') && !findIsScoped(toks)) {
    const unsafe = findPathArgs(toks).filter((t) => !isDisposableTarget(expandTarget(t, varMap)));
    if (unsafe.length) {
      return '`find ... -delete` under ' + unsafe.slice(0, 3).map((t) => '`' + t + '`').join(', ') +
        ' deletes every match with no confirmation and no recursive flag to notice. Blocked (Q1) -- ' +
        'run it without `-delete` first and read the list.';
    }
    return null;
  }

  // Moving a git checkout into a temp directory is a delete on a delay: /tmp is
  // cleared on reboot. Deliberately narrow -- source must be a repo root, dest
  // must be disposable -- because `mv` is otherwise far too common to police.
  if (base === 'mv' || base === 'move-item' || base === 'mi' || base === 'move') {
    const positional = stripRedirections(toks.slice(1)).filter((t) => !t.startsWith('-') && !/^\/{1,2}[a-z]$/i.test(t));
    if (positional.length >= 2) {
      const dest = expandTarget(positional[positional.length - 1], varMap);
      const sources = positional.slice(0, -1).map((s) => expandTarget(s, varMap));
      if (isDisposableTarget(dest)) {
        for (const src of sources) {
          let isRepo = false;
          try { isRepo = fs.existsSync(path.join(toNative(src), '.git')); } catch { isRepo = false; }
          if (isRepo && !isDisposableTarget(src)) {
            return 'Moving the git checkout `' + src + '` into `' + dest + '` puts it somewhere that is ' +
              'cleared on reboot, which loses it for good. Blocked (Q1) -- move it to a real location, ' +
              'or delete it deliberately if that is the intent.';
          }
        }
      }
    }
  }

  if (base === 'rsync' && toks.some((t) => /^--del(ete(-(before|during|after|delay|excluded))?)?$/.test(t))) {
    const positional = stripRedirections(toks.slice(1)).filter((t) => !t.startsWith('-'));
    const dest = positional[positional.length - 1];
    // A remote destination is egress, not local deletion; checkEgress and the
    // classifier own it. `\S+@\S+:` alone missed `$HOST:$DIR/` (no `@`), which
    // is how deploy scripts write it: 24 of 55 prompts in 2026-11-06..16 were
    // one deploy.sh to the author's own server, gated as a local delete.
    // A backup dir keeps every file rsync removes, so that form is recoverable.
    const backedUp = toks.some((t) => /^--backup(-dir)?(=|$)|^-b$/.test(t)) || toks.includes('--dry-run') || toks.includes('-n');
    if (dest && !isRemoteSpec(dest) && !backedUp && !isDisposableTarget(expandTarget(dest, varMap))) {
      return '`rsync --delete` makes `' + dest + '` an exact mirror of the source, removing everything ' +
        'there that the source does not have. Blocked (Q1) -- the recoverable form keeps what it removes: ' +
        'add `--backup --backup-dir=<a scratch folder>`, or run with `--dry-run` first and read the list.';
    }
  }

  // robocopy /MIR and /PURGE are rsync --delete: the destination loses every
  // file the source does not have. `robocopy <src> <dst> [files] [options]`.
  if (base === 'robocopy' && toks.some((t) => /^\/{1,2}(mir|purge)$/i.test(t))) {
    // Switches are `/MIR`, `/R:3`, `//XD` (Git Bash); `/c/src` is a path.
    const positional = toks.slice(1).filter((t) => !/^\/{1,2}[A-Za-z]+(:\S*)?$/.test(t));
    const dest = positional[1];
    if (dest && !isDisposableTarget(expandTarget(dest, varMap))) {
      return '`robocopy /MIR` (or `/PURGE`) makes `' + dest + '` an exact mirror of the source, deleting ' +
        'everything there that the source does not have. Blocked (Q1) -- run it with `/L` first and read the list.';
    }
  }
  return null;
}

// Deletes written in a language rather than a shell. `extractEmbeddedCommands`
// only pulls literals out of EXEC call sites, so a body that never shells out --
// `shutil.rmtree(...)`, `fs.rmSync(..., {recursive: true})`, `File::Path::rmtree`
// -- passed straight through. These are the native equivalents, not wrappers.
const NATIVE_DESTRUCTIVE = [
  [/\bshutil\.rmtree\s*\(\s*(['"])([^'"]*)\1/, 'shutil.rmtree'],
  [/\bos\.removedirs\s*\(\s*(['"])([^'"]*)\1/, 'os.removedirs'],
  // Matched on the METHOD, not on an `fs.` prefix: the idiomatic one-liner is
  // `require('fs').rmSync(...)`, where the receiver is a call expression and
  // the literal text `fs.rmSync` never appears. `recursive: true` is required,
  // so this cannot fire on an ordinary single-file unlink.
  [/\brm(?:Sync)?\s*\(\s*(['"])([^'"]*)\1[^)]*recursive\s*:\s*true/, 'fs.rm recursive'],
  [/\brmdirSync\s*\(\s*(['"])([^'"]*)\1[^)]*recursive\s*:\s*true/, 'fs.rmdirSync recursive'],
  [/\b(?:rmtree|remove_tree)\s*\(\s*(['"])([^'"]*)\1/, 'File::Path::rmtree'],
  [/\bFileUtils\.rm_rf\s*\(\s*(['"])([^'"]*)\1/, 'FileUtils.rm_rf'],
];

function checkNativeDestructive(code, varMap) {
  for (const [re, label] of NATIVE_DESTRUCTIVE) {
    const m = re.exec(code);
    if (!m) continue;
    const target = m[2];
    if (target && isDisposableTarget(expandTarget(target, varMap))) continue;
    return 'Code passed to an interpreter calls `' + label + '` on `' + (target || 'a computed path') +
      '`, which is a recursive delete written in a language instead of a shell. Blocked (Q1) -- ' +
      'the guard reads the body, not just the command name.';
  }
  return null;
}

// --- read-only fast path ----------------------------------------------------

// Granting outright (rather than falling through) is what removes the ~25
// false positives the corpus attributes to reads: `kubectl get pods -o name`,
// `az aks list --query`, `rg -n "API_KEY="`, `kubectl apply --dry-run=client`,
// `node --check`. Kept deliberately tight: every segment must qualify, nothing
// may be substituted or redirected into a file, and no credential-shaped path
// may appear -- reading a secret VALUE into the transcript is still egress.
const READ_ONLY = new Set([
  'ls', 'pwd', 'echo', 'printf', 'wc', 'file', 'stat', 'du', 'df', 'date',
  'head', 'tail', 'sort', 'uniq', 'cut', 'tr', 'column', 'jq', 'yq', 'basename',
  'dirname', 'which', 'type', 'uname', 'id', 'whoami', 'hostname', 'hostnamectl',
  'ps', 'free', 'uptime', 'lsblk', 'lscpu', 'lsusb', 'lspci', 'nproc', 'tree',
  'rg', 'grep', 'egrep', 'fgrep', 'diff', 'cmp', 'md5sum', 'sha256sum', 'cat',
  // PowerShell / Windows reads (Windows port). Scriptblock bodies are split
  // into their own segments in PowerShell mode, so a `Where-Object { ... }`
  // cannot smuggle a write past this list.
  'get-childitem', 'gci', 'dir', 'get-content', 'gc', 'get-item', 'gi', 'test-path',
  'get-location', 'gl', 'resolve-path', 'rvpa', 'select-string', 'sls', 'measure-object',
  'measure', 'select-object', 'select', 'where-object', 'where', '?', 'sort-object',
  'format-table', 'ft', 'format-list', 'fl', 'format-wide', 'fw', 'write-output', 'write',
  'write-host', 'get-command', 'gcm', 'get-date', 'get-filehash', 'get-process', 'gps',
  'get-service', 'gsv', 'get-itemproperty', 'gp', 'split-path', 'join-path', 'out-string',
  'convertto-json', 'convertfrom-json', 'get-member', 'gm', 'get-help', 'get-psdrive',
  'get-volume', 'get-disk', 'get-partition', 'get-netadapter', 'get-acl', 'get-host',
  'get-module', 'get-alias', 'compare-object', 'group-object', 'get-unique', 'out-host',
  'findstr', 'tasklist', 'systeminfo', 'get-computerinfo', 'get-filehash', 'get-psprovider',
]);

const READ_ONLY_SUB = {
  git: /^(status|diff|log|show|branch|remote|ls-files|ls-remote|rev-parse|describe|blame|shortlog|config|worktree|stash|tag|for-each-ref|cat-file|count-objects)$/,
  docker: /^(ps|images|logs|inspect|version)$/,
  npm: /^(ls|view|outdated|why)$/,
  pnpm: /^(ls|why|outdated)$/,
};

function isReadOnlySegment(toks, seg) {
  if (toks.sudo) return false;
  const base = baseOf(toks[0]);
  const all = toks.slice(1).join(' ');

  if (CREDENTIAL_FILE.test(seg)) return false;

  if (READ_ONLY.has(base)) return true;
  if (base === 'find') return !/-delete|-exec|-execdir|-ok|-fls|-fprint/.test(all);
  if (base === 'sed') return /(^|\s)-n(\s|$)/.test(' ' + all) && !/-i\b|--in-place/.test(all);
  if (base === 'awk') return !/print\s*>|system\s*\(/.test(seg);
  if (base === 'node') return /(^|\s)--check(\s|$)/.test(' ' + all);

  const sub = (toks[1] || '').toLowerCase();
  if (base === 'git' && READ_ONLY_SUB.git.test(sub)) {
    // `git config <key> <value>` writes; `git config --get` / bare read does not.
    if (sub === 'config' && toks.length > 3 && !/--get|--list|-l\b/.test(all)) return false;
    if (sub === 'worktree' && !/^list/.test(toks.slice(2).join(' '))) return false;
    if (sub === 'stash' && !/^(list|show)/.test(toks.slice(2).join(' '))) return false;
    if (sub === 'remote' && toks.length > 2 && !/^(-v|show|get-url)/.test(toks.slice(2).join(' '))) return false;
    if (sub === 'tag' && toks.length > 2 && !/^(-l|--list)/.test(toks.slice(2).join(' '))) return false;
    return true;
  }
  if (base === 'systemctl') {
    return /^(status|is-active|is-enabled|list-units|list-unit-files|show|cat)$/.test(sub);
  }
  if (base === 'kubectl') {
    if (/^(get|describe|logs|top|explain|api-resources|api-versions|version|auth)$/.test(sub)) {
      // `kubectl get secret -o yaml` prints secret values.
      if (/\bsecrets?\b/.test(all) && /-o\s*\S*(yaml|json)|--output/.test(all)) return false;
      return true;
    }
    if (sub === 'config') return /^(view|current-context|get-)/.test(toks.slice(2).join(' '));
    if (sub === 'apply') return /--dry-run/.test(all);
    return false;
  }
  if (base === 'az') {
    if (/\bget-access-token\b|\bkeys?\s+list\b|\bsecret\b/.test(all)) return false;
    return /\b(list|show|version)\b/.test(all) &&
      !/\b(create|delete|update|set|start|stop|restart|run|queue|invoke|cancel)\b/.test(all);
  }
  if (base === 'gh') {
    return /^(pr|issue|repo|run)\s+(list|view|status|diff|checks)\b/.test(all) ||
      (/^api\b/.test(all) && !/-X\s*(POST|PUT|PATCH|DELETE)|--method\s*(POST|PUT|PATCH|DELETE)/i.test(all));
  }
  if (READ_ONLY_SUB[base]) return READ_ONLY_SUB[base].test(sub);
  return false;
}

function isPlainlyReadOnly(rawCmd, segments, mode) {
  if (/\$\(|`|<\(|>\(/.test(rawCmd)) return false;             // command substitution
  if (/<<-?\s*['"]?[A-Za-z_]/.test(rawCmd)) return false;       // heredoc
  const redir = rawCmd.replace(/(\d|\*)?>\s*(\/dev\/null|\$null|nul)\b/gi, '').replace(/\d>&\d/g, '');
  if (/>>?/.test(redir)) return false;                          // writing to a file
  // PowerShell can act from inside an expression: `(Get-Item x).Delete()`,
  // `[IO.File]::Delete(...)`, `$x = ...`, `& $sb`. None of that is a plain read.
  if ((mode || SHELL_MODE) === 'powershell') {
    const unquoted = rawCmd.replace(/'[^']*'|"[^"]*"/g, '""');
    if (/::|\.\s*[A-Za-z_]\w*\s*\(|\$[A-Za-z_][\w:]*\s*=[^=]|(^|[\s;(])&\s*[$({'"]/.test(unquoted)) return false;
  }
  if (!segments.length) return false;
  for (const seg of segments) {
    const toks = unwrap(tokenise(seg));
    if (!toks.length) return false;
    if (!isReadOnlySegment(toks, seg)) return false;
  }
  return true;
}

// Grant, rather than fall through, when the whole command is the agent tidying
// up after itself. Falling through would hand the decision back to the
// classifier, and the classifier is the layer that was over-blocking: its
// Unverifiable Deletion Target rule fires on the shape `rm -rf`, not on what is
// being deleted, which is how deleting the session's own scratchpad ended up as
// the single most-refused command on this machine.
//
// The scope test is the important half. `grant()` releases the ENTIRE command
// string, so one segment doing anything else -- a curl, a push, a build, even a
// mkdir -- makes this false. Only reads, bare assignments, and recursive
// deletes whose every target passed the provenance test are allowed to appear.
function isSelfCleanupOnly(rawCmd, segments, cwd) {
  if (SESSION_START_MS === null) return false;
  if (/\$\(|`|<\(|>\(/.test(rawCmd)) return false; // command substitution: contents unknowable
  if (/<<-?\s*['"]?[A-Za-z_]/.test(rawCmd)) return false; // heredoc
  if (!segments.length) return false;

  const varMap = assignmentMap(stripHeredocs(rawCmd));
  if (cwd && !varMap.has('PWD')) varMap.set('PWD', cwd);

  let sawDelete = false;
  for (const seg of segments) {
    const toks = unwrap(tokenise(seg));
    if (!toks.length) continue;
    // `SB=/tmp/x` on its own line assigns and does nothing else.
    if (toks.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) continue;
    if (isReadOnlySegment(toks, seg)) continue;

    const targets = recursiveDeleteTargets(toks);
    if (targets === null || !targets.length) return false;
    for (const t of targets) {
      const expanded = expandTarget(t, varMap);
      if (/^-/.test(expanded)) return false;
      const abs = toAbs(expanded, cwd);
      if (!isAgentCreated(abs, cwd)) return false;
    }
    sawDelete = true;
  }
  return sawDelete;
}

// --- script bodies ----------------------------------------------------------

// The gap the corpus proved: 35 agent-authored scripts held always-block
// patterns and at least 3 were executed as files, while every guard read only
// `bash healthcheck.sh`. The content is sitting on disk at execution time.
const RUNNERS = /^(bash|sh|zsh|dash|ksh|python3?|node|perl|ruby|pwsh|powershell)$/;

// Inside a Python or Node body the shell grammar does not apply:
// `subprocess.run(["ydotool","key","ctrl+alt+f2"])` has no command head to
// parse. Pull the string literals back out and judge those as command lines.
// This runs ONLY inside interpreter code -- never over a plain shell command,
// so `echo "rm -rf x"` stays an argument, as it always was.
// Only literals that sit at an EXECUTION call site count. Without this scoping
// the guard reads its own test fixtures -- `node tests/replay.js` was denied in
// the corpus replay because the test file quotes the very strings it asserts on.
const EXEC_CALL = /(?:os\.system|subprocess\.(?:run|call|check_call|check_output|Popen)|child_process\.(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)|\bexecSync\b|\bspawnSync\b|\bexecFileSync\b|shell_exec|\bpopen\b|\bsystem)\s*\(/g;

// A comment is never executed. Without this, any file that DOCUMENTS a
// dangerous command gets flagged -- including this guard's own header, which is
// how the corpus replay caught it.
function stripCodeComments(code) {
  let out = '';
  let quote = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') { out += c + (code[i + 1] || ''); i++; continue; }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && code[i + 1] === '/') { const n = code.indexOf('\n', i); if (n < 0) break; i = n - 1; continue; }
    if (c === '/' && code[i + 1] === '*') { const n = code.indexOf('*/', i); if (n < 0) break; i = n + 1; continue; }
    if (c === '#') { const n = code.indexOf('\n', i); if (n < 0) break; i = n - 1; continue; }
    out += c;
  }
  return out;
}

function extractEmbeddedCommands(rawCode) {
  const code = stripCodeComments(rawCode);
  const out = [];
  let call;
  EXEC_CALL.lastIndex = 0;
  while ((call = EXEC_CALL.exec(code)) !== null) {
    // Only the call's OWN arguments count. A fixed-size window pulled in the
    // lines after the call and flagged this project's test suite.
    const open = code.indexOf('(', call.index);
    let depth = 0;
    let end = open;
    for (let i = open; i < code.length && i < open + 2000; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    const window = code.slice(open, end + 1);
    let m;
    const groupRe = /\[([^[\]]*)\]/g;
    while ((m = groupRe.exec(window)) !== null) {
      const parts = [];
      const inner = /(['"])((?:\\.|(?!\1).)*)\1/g;
      let g;
      while ((g = inner.exec(m[1])) !== null) parts.push(g[2]);
      if (parts.length > 1) out.push(parts.join(' '));
    }
    const litRe = /(['"])((?:\\.|(?!\1).)*)\1/g;
    while ((m = litRe.exec(window)) !== null) {
      if (m[2].length > 3 && /\s/.test(m[2])) out.push(m[2]);
    }
    if (out.length > 200) break;
  }
  return out.slice(0, 200);
}

// Regions of a command that are foreign-language code rather than shell:
// `python3 -c "..."` and a heredoc piped into an interpreter on stdin.
function foreignCodeRegions(cmd) {
  const regions = [];
  let m;
  const inline = /(^|[\s|;])(python3?|node|perl|ruby)\s+(?:-\w+\s+)*-(?:c|e)\s+(['"])((?:\\.|(?!\3).)*)\3/g;
  while ((m = inline.exec(cmd)) !== null) regions.push(m[4]);

  const re = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
  while ((m = re.exec(cmd)) !== null) {
    const lineStart = cmd.lastIndexOf('\n', m.index) + 1;
    if (!/\b(python3?|node|perl|ruby)\b/.test(cmd.slice(lineStart, m.index))) continue;
    const bodyStart = cmd.indexOf('\n', m.index);
    if (bodyStart < 0) continue;
    const rest = cmd.slice(bodyStart + 1);
    const endM = new RegExp('^\\s*' + m[2] + '\\s*$', 'm').exec(rest);
    regions.push(endM ? rest.slice(0, endM.index) : rest);
  }
  return regions;
}

const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ps1|psm1|pl|rb|bat|cmd)$/i;

function scriptTargets(toks, cwd) {
  const base = baseOf(toks[0]);
  const out = [];
  if (PS_HOSTS.has(base)) {
    // `pwsh -NoProfile -ExecutionPolicy Bypass -File x.ps1`: the value flags
    // would otherwise make `Bypass` the script.
    for (let i = 1; i < toks.length; i++) {
      const tk = toks[i];
      if (isPsParam(tk, 'file', 1)) { if (toks[i + 1]) out.push(toks[i + 1]); break; }
      if (isPsParam(tk, 'command', 1) || /^[-/](e|ec)$/i.test(tk) || isPsParam(tk, 'encodedcommand', 2)) break;
      if (/^[-/](executionpolicy|ep|ex|ex\w+|workingdirectory|wd|configurationname|outputformat|of|inputformat|if|windowstyle|w|settingsfile|custompipename)$/i.test(tk)) { i++; continue; }
      if (/^[-/]/.test(tk)) continue;
      out.push(tk); // `pwsh script.ps1` -- the first positional is the file
      break;
    }
  } else {
    const args = stripRedirections(toks.slice(1)).filter((a) => !a.startsWith('-'));
    if (RUNNERS.test(base) && args.length) out.push(args[0]);
    else if (base === 'source' || toks[0] === '.') { if (args.length) out.push(args[0]); }
    else if (/^\.{0,2}[\/\\]/.test(toks[0] || '')) out.push(toks[0]);
    // `C:\x\run.ps1`, `deploy.cmd`, `& "C:\x\y.ps1"` -- a script named as the head.
    else if (SCRIPT_EXT.test(toks[0] || '')) out.push(toks[0]);
  }
  return out
    .filter((p) => SCRIPT_EXT.test(p) || /^\.{0,2}[\/\\]/.test(p))
    .map((p) => toAbs(p, cwd));
}

// The grammar a script file is written in.
function scriptMode(file) {
  if (/\.(ps1|psm1)$/i.test(file)) return 'powershell';
  if (/\.(bat|cmd)$/i.test(file)) return 'cmd';
  return 'bash';
}

// --- Windows system rules (Windows port, 2026-11-14) -------------------------
//
// The Windows equivalents of the Linux tiers above -- not new policy. Each
// group names the Linux rule it mirrors. All are ASK: every one of these has a
// legitimate yes (formatting a USB stick, uninstalling an app, rebooting after
// an update), so none meets the DENY bar of "no reasonable answer is yes".
const WIN_DISK_CMDLETS = new Set([
  'clear-disk', 'format-volume', 'initialize-disk', 'remove-partition', 'new-partition',
  'resize-partition', 'set-partition', 'set-disk', 'remove-physicaldisk', 'reset-physicaldisk',
  'remove-virtualdisk', 'clear-physicaldiskhealthdata',
]);
const WIN_CRITICAL_PROCS = /^(explorer|dwm|winlogon|csrss|wininit|lsass|smss|services|svchost|sihost|fontdrvhost|logonui)(\.exe)?$/i;
const WIN_CRITICAL_SERVICES = new Set([
  'dhcp', 'dnscache', 'nlasvc', 'netprofm', 'wlansvc', 'lanmanworkstation', 'sshd', 'termservice',
  'rpcss', 'winmgmt', 'eventlog', 'bfe', 'mpssvc', 'netman', 'wcmsvc', 'dot3svc', 'iphlpsvc', 'nsi',
  'audiosrv', 'themes', 'sens', 'profsvc', 'usermanager', 'gpsvc',
]);
const MACHINE_HIVE = /(^|[\s"'\\/:])(hklm|hkey_local_machine|hkcr|hkey_classes_root|hku|hkey_users)(:|\\|\/|\s|$)|registry::hkey_(local_machine|classes_root|users)/i;
const PS_ITEM_MUTATORS = /^(remove-item|ri|del|erase|rd|rmdir|rm|remove-itemproperty|rp|set-itemproperty|sp|new-itemproperty|new-item|ni|rename-item|rni|rename-itemproperty|rnp|clear-itemproperty|clp|clear-item|cli|set-item|si|move-item|mi|move|copy-item|cpi|copy|move-itemproperty|mp|copy-itemproperty|cpp)$/;

// Windows switches come as `/x`, `-x` or (Git Bash) `//x`; normalise to `/x`.
const winSwitches = (rest) => rest.map((t) => t.replace(/^(\/\/|-)(?=[a-z?])/i, '/').toLowerCase());
const hasWhatIf = (rest) => rest.some((t) => /^-whatif(:\$true)?$/i.test(t));

function checkWindowsSystem(toks, seg) {
  if (!WIN_RULES || toks.wsl) return null;
  const base = baseOf(toks[0]);
  const raw = toks.slice(1);
  const rest = raw.map((t) => t.toLowerCase());
  const sw = winSwitches(raw);
  const all = rest.join(' ');

  // --- Q1: disks and filesystems (mirrors mkfs / parted / dd of=/dev) -------
  if (WIN_DISK_CMDLETS.has(base) && !hasWhatIf(rest)) {
    return '`' + toks[0] + '` changes a disk, partition table or volume and is not recoverable from here. ' +
      'Blocked (Q1) -- ask the user.';
  }
  if (base === 'diskpart') {
    return '`diskpart` edits disks and partition tables, and a script passed with /s runs unattended. Blocked (Q1) -- ask the user.';
  }
  if (base === 'format' && rest.length && !rest.every((t) => t === '/?')) {
    return '`format` destroys the filesystem on a volume. Blocked (Q1) -- ask the user.';
  }
  // Mirrors shred / wipefs.
  if ((base === 'cipher' && sw.some((t) => /^\/w(:|$)/.test(t))) || base === 'sdelete' || base === 'sdelete64') {
    return '`' + base + '` overwrites free space or files so nothing can be recovered. Blocked (Q1) -- ask the user.';
  }
  // Mirrors modprobe: boot configuration sits below anything this session can undo.
  if (base === 'bcdedit') {
    const reads = sw.every((t) => /^\/(enum|v|\?)$/.test(t) || !t.startsWith('/') && /^(all|active|firmware|bootapp|bootmgr|osloader|resume|inherit|\{[^}]*\})$/.test(t));
    if (sw.length && !reads) {
      return '`bcdedit` changes the boot configuration; a wrong value leaves the machine unbootable. Blocked (Q1) -- ask the user.';
    }
  }
  if (base === 'bcdboot' || base === 'bootrec' || base === 'bootsect') {
    return '`' + base + '` rewrites boot records. Blocked (Q1) -- ask the user.';
  }
  // Mirrors timeshift --delete / btrfs subvolume delete: the rollback points.
  if (base === 'vssadmin' && /\b(delete\s+shadows|resize\s+shadowstorage)\b/.test(all)) {
    return 'Deleting or shrinking Volume Shadow Copies removes the machine\'s restore points -- the thing that ' +
      'makes everything else recoverable. Blocked (Q1).';
  }
  if (base === 'wmic' && /\bshadowcopy\b/.test(all) && /\bdelete\b/.test(all)) {
    return 'Deleting shadow copies removes the machine\'s restore points. Blocked (Q1).';
  }
  if (base === 'wbadmin' && /^delete\b/.test(all)) {
    return '`wbadmin delete` removes backups. Blocked (Q1) -- ask the user.';
  }
  if (base === 'disable-computerrestore') {
    return 'Turning off System Restore removes the rollback point. Blocked (Q1) -- ask the user.';
  }

  // --- Q1: packages and drivers (mirrors apt remove / dpkg -r / modprobe) ---
  if ((base === 'winget' && /^(uninstall|remove|rm)$/.test(rest[0] || '')) ||
      ((base === 'choco' || base === 'scoop') && /^(uninstall|remove)$/.test(rest[0] || '')) ||
      /^(uninstall-package|uninstall-module|remove-appxpackage|remove-appxprovisionedpackage|remove-windowscapability|disable-windowsoptionalfeature|uninstall-windowsfeature|remove-windowsfeature)$/.test(base) ||
      (base === 'msiexec' && sw.some((t) => /^\/(x|uninstall)$/.test(t))) ||
      (base === 'dism' && sw.some((t) => /^\/(remove-|disable-feature)/.test(t)))) {
    return 'Removing packages or Windows features can take out something another tool depends on and is ' +
      'awkward to undo. Blocked -- ask the user, or install alongside instead.';
  }
  if (base === 'pnputil' && sw.some((t) => /^\/(delete-driver|remove-device|disable-device|add-driver)$/.test(t))) {
    return 'Adding or removing a driver reaches below anything this session can undo. Blocked (Q1) -- ask the user.';
  }

  // --- Q1: machine registry (mirrors raw writes into /sys) ------------------
  if (base === 'reg' && /^(delete|add|import|restore|load|unload|copy)$/.test(rest[0] || '') && MACHINE_HIVE.test(seg)) {
    return 'Writing to or deleting from the machine registry (HKLM/HKCR/HKU) changes system behaviour with no ' +
      'undo record. Blocked (Q1) -- ask the user, and export the key first (`reg export`).';
  }
  if (PS_ITEM_MUTATORS.test(base) && MACHINE_HIVE.test(seg)) {
    return 'Changing the machine registry (HKLM/HKCR/HKU) through the registry provider has no undo record. ' +
      'Blocked (Q1) -- ask the user, and export the key first (`reg export`).';
  }

  // --- Q1: ACL/ownership sweeps (mirrors chown -R /) ------------------------
  if ((base === 'takeown' && sw.some((t) => t === '/r')) || (base === 'icacls' && sw.some((t) => t === '/t'))) {
    const targets = [];
    for (let i = 0; i < raw.length; i++) {
      const t = raw[i];
      // takeown names its target with `/f <path>`; icacls takes it positionally.
      if (base === 'takeown' && /^\/{1,2}f$/i.test(t)) { if (raw[i + 1]) targets.push(raw[i + 1]); i++; continue; }
      if (/^\/{1,2}[a-z]+$/i.test(t)) { if (/^\/{1,2}(grant|deny|remove|setowner|save|restore|setintegritylevel|inheritance|d|s|u|p)$/i.test(t)) i++; continue; }
      if (/^-/.test(t)) continue;
      targets.push(t);
    }
    const bad = targets.filter((t) => isSystemRoot(normalise(expandTarget(t)) || '/'));
    if (bad.length) {
      return 'Recursive ownership or permission changes over ' + bad.map((t) => '`' + t + '`').join(', ') +
        ' are effectively irreversible without a full reinstall. Blocked (Q1).';
    }
  }

  // --- Q3: ending the session (mirrors systemctl stop gdm / loginctl) -------
  if (base === 'shutdown') {
    if (sw.some((t) => t === '/a')) return null; // aborting a pending shutdown
    if (sw.some((t) => /^\/(s|r|l|h|p|g|sg|o|i|fw|soft)$/.test(t))) {
      return 'Shutting down, restarting, hibernating or logging off ends this session, so nothing after it ' +
        'can be verified. Blocked (Q3) -- ask the user.';
    }
  }
  if ((base === 'stop-computer' || base === 'restart-computer') && !hasWhatIf(rest)) {
    return '`' + toks[0] + '` ends this session, so nothing after it can be verified. Blocked (Q3) -- ask the user.';
  }
  if (base === 'logoff' || base === 'tsdiscon' ||
      (base === 'rundll32' && /(powrprof\.dll,setsuspendstate|user32\.dll,lockworkstation|shell32\.dll,sht?utdown)/.test(all))) {
    return 'Logging off, suspending or locking the desktop takes it away from the session. Blocked (Q3).';
  }
  // Mirrors `pkill gnome-shell`.
  if ((base === 'stop-process' || base === 'spps' || base === 'kill' || base === 'taskkill') &&
      raw.some((t) => WIN_CRITICAL_PROCS.test(t.replace(/^.*[\\/]/, '').replace(/^\/{1,2}im$/i, '')))) {
    return 'Killing the shell, compositor or a core system process ends the desktop and every unsaved ' +
      'thing in it. Blocked (Q3).';
  }

  // --- Q3: services (mirrors systemctl stop/disable on critical units) ------
  const svcVerb = (base === 'sc' || base === 'net') ? (rest[0] || '') : '';
  const stopsService = /^(stop-service|spsv|suspend-service)$/.test(base) ||
    (base === 'set-service' && /-(startuptype|startup|st)\s*:?\s*disabled|-status\s*:?\s*(stopped|paused)/.test(all)) ||
    (base === 'sc' && /^(stop|pause|config|delete)$/.test(svcVerb)) ||
    (base === 'net' && /^(stop|pause)$/.test(svcVerb));
  if (stopsService) {
    const names = rest.filter((t) => !/^[-/]/.test(t) && !/^(stop|pause|config|delete|start=|disabled|demand)$/.test(t))
      .flatMap((t) => t.split(','));
    if (base === 'sc' && svcVerb === 'delete') {
      return '`sc delete` removes a service registration, which is awkward to restore. Blocked (Q1) -- ask the user.';
    }
    if (base === 'sc' && svcVerb === 'config' && !/start=\s*disabled|start=\s*demand/.test(all)) return null;
    if (names.some((n) => WIN_CRITICAL_SERVICES.has(n.replace(/^["']|["']$/g, '')))) {
      return 'Stopping or disabling a network, remote-access or core Windows service cuts this session off ' +
        'or breaks the desktop, so nothing after it can be verified. Blocked (Q3) -- ask the user.';
    }
  }

  // --- Q3: network lockout (mirrors ufw / iptables / nmcli / ip link down) --
  if (base === 'netsh' && (
    /\badvfirewall\b.*\b(reset|state\s+(off|on))\b/.test(all) ||
    /\badvfirewall\b.*\bfirewallpolicy\b.*\bblock/.test(all) ||
    /\badvfirewall\s+firewall\s+(add|set)\b.*\baction=block\b/.test(all) ||
    /\binterface\b.*\b(admin=)?disabled?\b/.test(all) ||
    /\b(winsock|int(erface)?\s+ip(v4|v6)?)\s+reset\b/.test(all) ||
    /\binterface\s+ip(v4|v6)?\s+(set|delete)\s+(address|dnsservers?|route)\b/.test(all))) {
    return 'Firewall, adapter or IP changes can lock this machine out of the network mid-task. Blocked (Q3) -- ask the user.';
  }
  if ((base === 'set-netfirewallprofile' && /-(enabled\s*:?\s*(false|\$false|0)|default(in|out)boundaction\s*:?\s*block)/.test(all)) ||
      (/^(new-netfirewallrule|set-netfirewallrule)$/.test(base) && /-action\s*:?\s*block/.test(all)) ||
      /^(disable-netadapter|restart-netadapter|remove-netipaddress|set-netipaddress|new-netipaddress|remove-netroute|set-dnsclientserveraddress|disable-netadapterbinding)$/.test(base) ||
      (base === 'ipconfig' && sw.some((t) => /^\/(release6?|renew6?)$/.test(t)))) {
    if (hasWhatIf(rest)) return null;
    return 'Firewall, adapter or IP changes can lock this machine out of the network mid-task. Blocked (Q3) -- ask the user.';
  }
  // Security controls off (mirrors `ufw disable`).
  if ((base === 'set-mppreference' && /-disable\w*(\s+(\$true|1|true)|:\$true|\s*$)/.test(all)) ||
      (base === 'add-mppreference' && /-exclusion\w+/.test(all)) ||
      (base === 'netsh' && /\badvfirewall\b.*\bstate\s+off\b/.test(all))) {
    return 'Turning off Defender protection or adding an exclusion weakens the machine\'s security controls. ' +
      'Blocked (Q3) -- ask the user.';
  }
  // Execution policy above Process scope is a persistent security setting.
  if (base === 'set-executionpolicy') {
    let scope = 'localmachine';
    const pos = [];
    for (let i = 0; i < rest.length; i++) {
      const t = rest[i];
      if (/^-sc(o(pe?)?)?:/.test(t)) { scope = t.slice(t.indexOf(':') + 1); continue; }
      if (/^-sc(o(pe?)?)?$/.test(t)) { scope = rest[i + 1] || scope; i++; continue; }
      if (/^-(executionpolicy|ep|e\w*)$/.test(t)) { pos.push(rest[i + 1] || ''); i++; continue; }
      if (t.startsWith('-')) continue;
      pos.push(t);
    }
    if (pos.length >= 2 && !rest.some((t) => /^-sc/.test(t))) scope = pos[1];
    if (!/^(process|currentuser)$/.test(scope.replace(/['"]/g, '')) && !hasWhatIf(rest)) {
      return 'Changing the machine-wide PowerShell execution policy is a persistent security setting. ' +
        'Blocked (Q3) -- ask the user, or use `-Scope Process` for this session only.';
    }
  }

  // --- Q3: the record of what happened (mirrors journalctl --vacuum) --------
  if ((base === 'wevtutil' && /^(cl|clear-log|um|uninstall-manifest)$/.test(rest[0] || '')) ||
      base === 'clear-eventlog' || base === 'remove-eventlog') {
    return 'Clearing a Windows event log destroys the record of what just happened. Blocked (Q3).';
  }
  return null;
}

// PowerShell-shaped deletes that the per-segment parser cannot see, because
// the target and the delete sit in different pipeline stages or in a .NET call.
function checkPsRaw(rawCmd, mode, varMap, cwd) {
  // `[IO.Directory]::Delete('X', $true)` and `(Get-Item X).Delete($true)` --
  // the native recursive delete, mirroring shutil.rmtree / fs.rmSync.
  const dn = /\[(?:system\.)?io\.directory\]::delete\s*\(\s*(['"]?)([^'",)]+)\1\s*,\s*\$true/i.exec(rawCmd) ||
    /\[microsoft\.visualbasic\.fileio\.filesystem\]::deletedirectory\s*\(\s*(['"]?)([^'",)]+)\1/i.exec(rawCmd);
  if (dn) {
    const t = expandTarget(dn[2], varMap);
    if (!isDisposableTarget(t) && !isAgentCreated(toAbs(t, cwd), cwd)) {
      return 'A .NET recursive directory delete of `' + dn[2] + '` is `rm -rf` written as a method call. ' +
        'Blocked (Q1) -- use `bash ~/.claude/bin/safe-rm ' + dn[2] + '`, which is recoverable.';
    }
  }
  if (/\.delete\s*\(\s*\$true\s*\)/i.test(rawCmd)) {
    return 'A `.Delete($true)` call is a recursive directory delete on a target the guard cannot resolve. ' +
      'Blocked (Q1) -- name the path in a Remove-Item or safe-rm call instead.';
  }

  // `Get-ChildItem X -Recurse | Remove-Item` is `find X -delete`: every file in
  // the tree goes, and the Remove-Item stage carries neither a target nor a
  // -Recurse to notice. Same carve-outs as find: a -Filter/-Include/wildcard
  // scope is a cleanup, a disposable root is fine.
  for (const stmt of splitSegments(rawCmd, mode, true)) {
    const stages = splitPipes(stmt);
    if (stages.length < 2) continue;
    const toksList = stages.map((s) => unwrap(tokenise(s)));
    const srcIdx = toksList.findIndex((t) => /^(get-childitem|gci|dir|ls)$/.test(baseOf(t[0])) &&
      t.slice(1).some((a) => isRecursiveFlag(a, 'powershell') || /^-r$/i.test(a)));
    if (srcIdx < 0) continue;
    const sinkIdx = toksList.findIndex((t, i) => i > srcIdx && PS_REMOVE.has(baseOf(t[0])) || i > srcIdx && baseOf(t[0]) === 'rm');
    if (sinkIdx < 0) continue;
    const src = toksList[srcIdx].slice(1);
    const scoped = src.some((a) => /^-(fil(t(er?)?)?|inc(l(u(de?)?)?)?)$/i.test(a) || /^-(fi|in)\w*:/i.test(a)) ||
      src.some((a) => !a.startsWith('-') && /\*\.\w+$|\*[^\\/]*$/.test(a) && !/[\\/]\*$/.test(a));
    if (scoped) continue;
    const paths = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      if (a.startsWith('-')) {
        if (a.includes(':') && isPsPathParam(a.toLowerCase().replace(/:.*$/, ''))) paths.push(a.slice(a.indexOf(':') + 1));
        else if (PS_VALUE_PARAMS.has(a.toLowerCase()) || /^-depth$/i.test(a)) i++;
        continue;
      }
      paths.push(a);
    }
    if (!paths.length) paths.push('.');
    const unsafe = paths.filter((p) => {
      const t = expandTarget(p, varMap);
      return !isDisposableTarget(t) && !isAgentCreated(toAbs(t, cwd), cwd);
    });
    if (unsafe.length) {
      return '`Get-ChildItem -Recurse ' + unsafe[0] + ' | Remove-Item` deletes every file in that tree with no ' +
        'recursive flag on the delete to notice -- the PowerShell spelling of `find ... -delete`. Blocked (Q1) -- ' +
        'run it without the Remove-Item stage first and read the list.';
    }
  }

  // `Get-Process explorer | Stop-Process` -- the target is in the first stage.
  if (WIN_RULES && /\b(get-process|gps|ps)\b[^|;\n]*\|\s*(stop-process|spps|kill)\b/i.test(rawCmd)) {
    const m = /\b(get-process|gps|ps)\b([^|;\n]*)\|/i.exec(rawCmd);
    if (m && m[2].split(/[\s,'"]+/).some((t) => WIN_CRITICAL_PROCS.test(t))) {
      return 'Killing the shell, compositor or a core system process ends the desktop and every unsaved ' +
        'thing in it. Blocked (Q3).';
    }
  }
  return null;
}

// --- engine -----------------------------------------------------------------

function evaluate(rawCmd, cwd, depth, mode) {
  if (rawCmd == null) return null;
  mode = mode || SHELL_MODE;
  const prevMode = SHELL_MODE;
  SHELL_MODE = mode;
  try {
    return evaluateIn(rawCmd, cwd, depth || 0, mode);
  } finally {
    SHELL_MODE = prevMode;
  }
}

function evaluateIn(rawCmd, cwd, depth, mode) {
  const pipe = checkPipeToShell(rawCmd);
  if (pipe) return asVerdict(pipe);

  if (depth === 0) {
    for (const region of foreignCodeRegions(rawCmd)) {
      const native = checkNativeDestructive(region, assignmentMap(rawCmd));
      if (native) return asVerdict(native);
      for (const embedded of extractEmbeddedCommands(region)) {
        const r = evaluate(embedded, cwd, depth + 1, 'bash');
        if (r) {
          return rewrap(r, 'Code passed to an interpreter contains an action that is gated on its own: ',
            ' (Wrapping a command in Python or Node does not change what it does -- the guard reads it.)');
        }
      }
    }
  }

  const body = stripHeredocs(rawCmd);
  const varMap = assignmentMap(body);
  // `$PWD` is the session's working directory, not this hook process's. Without
  // this seed, `SB="$PWD/fakehome"; rm -rf "$SB"` resolved against whatever
  // directory the guard happened to be launched in.
  if (cwd && !varMap.has('PWD')) varMap.set('PWD', cwd);

  const psr = checkPsRaw(body, mode, varMap, cwd);
  if (psr) return asVerdict(psr);

  // Follow `cd` so a later relative delete is judged where it really runs:
  // `cd /tmp/x && rm -r bundle` was gated as a one-way delete of `bundle`.
  let segCwd = cwd;
  for (const seg of splitSegments(body, mode)) {
    const toks = unwrap(tokenise(seg));
    if (!toks.length) continue;
    if (/^(cd|set-location|sl|chdir|pushd)$/.test(baseOf(toks[0])) && toks.length === 2 && segCwd) {
      const t = expandTarget(toks[1], varMap);
      if (!/[$`*?%]/.test(t)) segCwd = toAbs(t, segCwd);
      continue;
    }

    for (const rule of [checkObserverLoss, checkSelfPrivilege, checkWindowsSystem, checkUnrecoverable, checkEgress, checkCredentialRead]) {
      const r = rule(toks, seg);
      if (r) return asVerdict(r);
    }
    const g = checkGitHistory(toks);
    if (g) return asVerdict(g);
    const d = checkDelete(toks, varMap, segCwd);
    if (d) return asVerdict(d);
    const b = checkBulkDelete(toks, seg, varMap);
    if (b) return asVerdict(b);
    const h = checkResourceHazard(toks, seg, varMap);
    if (h) return asVerdict(h);

    // A command carried inside an argument -- `bash -c "..."`, `xargs rm -rf`,
    // `find ... -exec rm -rf {} +` -- is still that command.
    if (depth < 3) {
      for (const nested of nestedCommands(toks)) {
        if (nested.encoded) {
          // -EncodedCommand exists to hide a script from whoever reads the
          // command line, which is every layer of review here. Decode and judge
          // it; when the guard cannot read it, or it reads clean, a human still
          // decides, because the classifier and the transcript only see base64.
          if (nested.cmd == null) {
            return ASK('`-EncodedCommand` payload could not be decoded as text, so nobody reviewing this ' +
              'can see what it runs. Blocked -- rewrite it as a plain `-Command`.');
          }
          const r = evaluate(nested.cmd, cwd, depth + 1, 'powershell');
          if (r) {
            return rewrap(r, 'An -EncodedCommand payload is gated on its own: ',
              ' (Encoding a command does not change what it does -- the guard decodes it.)');
          }
          return ASK('`-EncodedCommand` hides the script from every reviewer of the command line. Decoded it reads:\n  ' +
            nested.cmd.slice(0, 300).replace(/\s+/g, ' ') + '\nApprove only if that is what you meant -- ' +
            'or rewrite it as a plain `-Command`, which needs no approval.');
        }
        const r = evaluate(nested.cmd, cwd, depth + 1, nested.mode);
        if (r) {
          return rewrap(r, 'A command passed as an argument is gated on its own: ',
            ' (Wrapping it in a shell, xargs or find does not change what it does.)');
        }
      }
    }

    if (depth === 0) {
      for (const file of scriptTargets(toks, cwd)) {
        let content = null;
        try {
          const st = fs.statSync(file);
          if (st.isFile() && st.size <= 512 * 1024) content = fs.readFileSync(file, 'utf8');
        } catch { /* not written yet, or unreadable: nothing to judge */ }
        if (content) {
          // Shell scripts parse as shell; a .py/.js body does not, so judge its
          // string literals instead.
          const isShellish = /\.(sh|bash|zsh|ps1|psm1|bat|cmd)$/i.test(file) || !/\.\w+$/.test(file);
          let inner = null;
          if (isShellish) {
            inner = evaluate(content, cwd, depth + 1, scriptMode(file));
          } else {
            // Deliberately NOT running checkNativeDestructive over a whole file
            // body. A file that merely QUOTES `shutil.rmtree(...)` -- a test
            // fixture, a doc, this project's own replay suite -- would match,
            // and the guard blocking its own tests is precisely the
            // false-positive class that gets all guards switched off. Only
            // exec-call-site literals are judged here, same as before.
            // Inline `-c`/`-e` payloads and stdin heredocs are still scanned
            // natively in evaluate(), which is where the real bypasses were.
            for (const embedded of extractEmbeddedCommands(content)) {
              inner = evaluate(embedded, cwd, depth + 1, 'bash');
              if (inner) break;
            }
          }
          if (inner) {
            return rewrap(inner, 'The script `' + path.basename(file) + '` contains an action that is gated on its own: ',
              ' (Running a script does not change what the script does -- the guard reads it.)');
          }
        }
      }
    }
  }
  return null;
}

// --- main -------------------------------------------------------------------

// Exported for the replay test suite; no effect when run as a hook.
if (require.main !== module) {
  module.exports = {
    evaluate, isPlainlyReadOnly, splitSegments, stripHeredocs, normalise, toNative,
    // The provenance test needs a session start time, which only exists in a
    // real hook payload. The suites set it explicitly so the agent-created
    // carve-out can be exercised, and left null everywhere else so the rest of
    // the corpus keeps grading the basename rules on their own.
    __setSessionStart: (ms) => { SESSION_START_MS = ms; },
  };
} else {
  let raw = '';
  try {
    raw = fs.readFileSync(0, 'utf8');
  } catch {
    allow();
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    allow();
  }

  const HIGH_STAKES = new RegExp([
    '\\brm\\b', '\\bsudo\\b', '\\bdd\\b', 'mkfs', 'ydotool', 'xdotool', 'wtype', 'chvt', 'modprobe', 'reflog',
    '--prune', 'systemctl', 'iptables', '\\bufw\\b',
    // Windows port: the same fail-closed set, Windows spelling.
    'remove-item', '\\brd\\b', '\\brmdir\\b', '\\bdel\\b', '\\berase\\b', 'diskpart', '\\bformat\\b',
    'clear-disk', 'format-volume', 'initialize-disk', 'remove-partition', 'bcdedit', 'vssadmin',
    '\\bcipher\\b', '\\breg\\b', '-enc', '\\biex\\b', 'invoke-expression', 'shutdown', 'stop-computer',
    'restart-computer', 'set-executionpolicy',
  ].join('|'), 'i');
  let cmdForFailClosed = '';

  try {
    const tool = payload.tool_name || payload.toolName;
    if (tool !== 'Bash' && tool !== 'PowerShell') allow();
    SHELL_MODE = tool === 'PowerShell' ? 'powershell' : 'bash';

    const input = payload.tool_input || payload.toolInput || {};
    const cmd = input.command;
    if (typeof cmd !== 'string' || !cmd.trim()) allow();
    cmdForFailClosed = cmd;

    const cwd = payload.cwd || input.cwd || process.cwd();
    LOG_CONTEXT = { session: payload.session_id || null, cwd, cmd };
    SESSION_START_MS = readSessionStart(payload);
    AUTOSAVE = freshAutosave(cwd);

    const verdict = asVerdict(evaluate(cmd, cwd, 0));
    if (verdict) decide(...finalTier(verdict));

    // Grant outright rather than falling through: the settings.json `ask` list
    // still carries git restore / clean --force / branch -D, and falling
    // through would let those re-gate a command the snapshot already made safe.
    if (AUTOSAVE) {
      const segs0 = splitSegments(stripHeredocs(cmd));
      const gitSegs = segs0.map((s) => unwrap(tokenise(s)))
        .filter((t) => t.length && baseOf(t[0]) === 'git');
      if (gitSegs.length && gitSegs.every((t) => RECOVERABLE_GIT.test((stripGitGlobals(t)[0] || '').toLowerCase()))) {
        grant('Recoverable: the worktree (tracked and untracked) was snapshotted to ' + AUTOSAVE.ref +
          ' moments ago, so this can be undone with `git checkout ' + AUTOSAVE.ref + ' -- .`');
      }
    }

    // Nothing objected. If the whole command is plainly read-only, grant it
    // outright so the classifier is not consulted at all -- reads were the
    // single largest false-positive class, and a read cannot lose data, reach
    // past this machine, or affect what can be observed.
    const segs = splitSegments(stripHeredocs(cmd));
    if (isPlainlyReadOnly(cmd, segs)) {
      grant('Read-only command: it cannot lose data, reach past this machine, or affect what can be observed.');
    }

    if (isSelfCleanupOnly(cmd, segs, cwd)) {
      grant('Cleanup of the agent\'s own leftovers: every path this deletes was created after the session ' +
        'started, is not tracked by git, and sits inside the session\'s working tree or a temp root. ' +
        'Nothing that existed before the session is touched.');
    }
  } catch (e) {
    // Fail closed for the set this layer is now solely responsible for; fail
    // open for everything else, because a guard must never wedge a session.
    if (HIGH_STAKES.test(cmdForFailClosed)) {
      decide(...finalTier(ASK('The local guard could not parse this command (' + (e && e.message ? e.message : 'parse error') +
        ') and it mentions a high-stakes operation, so it is not guessing. Rewrite it as simpler, ' +
        'single-purpose commands.')));
    }
    allow();
  }

  allow();
}
