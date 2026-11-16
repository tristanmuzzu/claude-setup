---
name: wizard
description: Generate an interactive bash script that walks the user through steps only they can perform, then runs them with their authority. Use for credentials, third-party dashboards, CI secrets, a one-off migration or cutover, and for settings.json permissions/autoMode/hooks changes the classifier blocks the agent from making.
---

# Wizard

A wizard is a bash script that walks a human through a procedure the agent
cannot do itself: it opens each URL, says exactly what to click and copy,
captures the values, writes them where they belong, confirms before anything
irreversible, and shows how many stages are left.

The reason it belongs in this harness is narrower and more useful than
credentials. Some work is blocked not by capability but by authority: editing
`permissions`, `autoMode` or `hooks` in `settings.json` is the self-privilege
class the classifier blocks, and blocks correctly. A script the user runs carries
the user's authority, so the agent can author the change in full and hand over one
command instead of a paragraph of instructions. This skill generates that kind of script.

Do not reach for this for steps the agent can perform itself. A wizard for work
you were allowed to do is a stop that did not need to happen.

**Platforms.** macOS runs it in Terminal. Windows runs it in Git Bash, which
Claude Code on Windows already needs (`"C:\Program Files\Git\bin\bash.exe" script.sh`).
`open_url` handles `xdg-open`, `open`, `wslview` and `cmd.exe start`. Keep the
script to bash 3.2 features (no associative arrays, no `${var,,}`), because that
is the bash macOS ships.

## The library is not yours to edit

`template.sh` already solves the interaction: stage headers with progress,
confirmation gates, cross-platform URL opening, hidden secret entry, idempotent
`.env` upserts at mode 600, `gh secret` and `gh variable` writes, timestamped
backups with a printed rollback, and `DRY_RUN=1` throughout. Everything above the
`STAGES` marker is identical in every wizard. Copy it, never hand-edit it.

Your job is to scope the procedure and author its stages.

A wizard is ephemeral by default: built for one run, written to the session
scratchpad or `scripts/`, deleted when the job is done. Commit it only when it is
a repeatable setup path that should live in the repo.

## 1. Scope the procedure

Work out every manual step and every value captured along the way. Read the repo
first rather than asking cold:

- Setup: `.env`, `.env.example`, `README`, `docker-compose*`, framework config,
  and `.github/workflows/*`, where every `secrets.*` and `vars.*` reference is a
  value the wizard must produce.
- Migration or cutover: the current state, the target state, and the
  irreversible actions between them.
- Harness changes: the exact `settings.json` keys, their before and after
  values, and what breaks if only half applies.

Then show the ordered stage list and the values each produces. The user may add,
drop or reorder.

**Done when** every stage is named in order and, for each captured value, you
know where the human gets it, where it is written, and whether it is secret.

## 2. Map each stage's journey

For each stage, write the precise path: which URL, what to do there, where the
value appears, which variable it fills. "Dashboard, then Developers, then API
keys, then Reveal test key, then copy."

Where you do not know the current interface or the exact command, check the docs
or say so. Never invent steps that may not exist; a wizard that sends someone to
a page that is not there is worse than no wizard.

**Done when** every stage traces to instructions a stranger could follow.

## 3. Author it

Copy `template.sh` to the target path. Replace the example stage with one
`stage` per step in dependency order, and set `TOTAL_STAGES`.

Helpers: `stage`, `say`, `step`, `note`, `warn`, `open_url`, `ask`,
`ask_secret`, `write_env`, `set_secret`, `set_var`, `backup_file`, `run_cmd`,
`confirm`, `pause`, `finish`.

Hold the bar the template sets. Open the URL before asking for its value. Use
`ask_secret` for anything secret, so it is never echoed and never lands in shell
history. Call `backup_file` before mutating any file the human did not create in
this run. Use `confirm` before anything irreversible. Keep one focused task per
stage, because each `stage` clears the screen and anything the human still needs
must not scroll away.

For anything that changes harness configuration, three things are mandatory,
because they are what makes the change reversible: honour `DRY_RUN=1` in every
mutating stage, `backup_file` every file touched, and let `finish` print the
rollback. State the rollback in the handover message too.

## 4. Verify, then hand off

- `bash -n <script>`, then `shellcheck -S warning <script>`. Both clean.
- `chmod +x <script>`.
- Run it once with `DRY_RUN=1` and piped input. It must reach `finish` without
  hanging and without touching anything.
- Trace it statically against step 1: every value is captured and lands where
  step 1 said, and every `set_secret` name matches a `secrets.*` reference in
  CI.
- Do not run it live end to end yourself. It opens browsers and blocks on human
  input, and the whole point is that the human holds the authority.

Then hand over the single command to run, and what will change when it does.
