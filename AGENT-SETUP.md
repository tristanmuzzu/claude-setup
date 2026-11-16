# Agent setup guide

You are a coding agent (Claude Code) setting up this kit on the computer you
run on, for the person you are working with. Follow the steps in order. Each
step says what done looks like; do not move on until it holds.

Ground rules:

- Keep everything the person already has. The installer merges and backs up;
  never delete or replace their own settings, rules, skills or hooks.
- Never ask for, type or store a password, token or API key. Sign-ins happen
  in the person's own browser or app.
- Ask before anything that starts at login, and before installing an optional
  app they did not pick.
- Detect the operating system first and use the matching commands. On Windows,
  your Bash tool runs in Git Bash, so the bash commands below work there; give
  the person PowerShell only when a step says so.
- Report honestly. If a step fails, say which one, quote the shortest decisive
  error line, and try the fallback the step names before giving up.

## 1. Prerequisites

Check each one with the command shown, and install only what is missing.

| Need | Check | Windows | macOS |
|---|---|---|---|
| Git | `git --version` | Git for Windows (Claude Code already needs it): `winget install --id Git.Git -e` | `xcode-select --install`, or `brew install git` |
| Node 18+ | `node --version` | `winget install --id OpenJS.NodeJS.LTS -e` | `brew install node`, or the installer from nodejs.org |
| Claude Code CLI | `claude --version` | PowerShell: `irm https://claude.ai/install.ps1 \| iex` | `curl -fsSL https://claude.ai/install.sh \| bash` |
| GitHub CLI (optional) | `gh --version` | `winget install --id GitHub.cli -e` | `brew install gh` |

The desktop app alone does not always put `claude` on PATH; the CLI is needed
for the plugin commands in step 5. `winget` and the PowerShell installer may
need the person to approve a prompt. If a command must run in PowerShell, hand
it to them in a `powershell` code block. After installing, open a new shell
(or tell them to restart the app) so PATH picks it up.

**Done when** `git`, `node` (18 or newer) and `claude` all print a version.

## 2. Get the kit

    git clone https://github.com/tristanmuzzu/claude-setup.git "$HOME/claude-setup"

If the folder already exists, `git -C "$HOME/claude-setup" pull` instead.
Keep this folder: updates come from it.

**Done when** `$HOME/claude-setup/AGENT-SETUP.md` exists.

## 3. Interview, then write CLAUDE.md

Ask these in one go (one question card if you have one, otherwise one short
message). Offer the default in brackets:

1. What should I call you?
2. How do you work: desktop app only, or terminal too? Do you dictate (so
   misheard words are likely)? How technical do you want answers?
   [desktop app, no dictation, technical]
3. Want one short "Worth knowing" note at the end of answers that did real
   work, explaining the idea behind it? [yes]
4. When you ask for a change to one of your own apps or sites that already has
   a live destination, should finishing include publishing it there without
   asking again? If yes, what is your GitHub user name? [no, ask each time]
5. Should I commit and push verified work without asking? If yes, which email
   do your commits use? [yes; read `git config --global user.email`]
6. Should new chats start in auto mode, where a safety check approves routine
   actions instead of asking you each time? The two safety hooks still stop
   force-pushes, mass deletes and the like. [yes]

Then build `~/.claude/CLAUDE.md` from `$HOME/claude-setup/home/CLAUDE.template.md`
and replace every `{{PLACEHOLDER}}`:

- `{{NAME}}`: their answer to 1.
- `{{HOW_THEY_WORK}}`: two to four bullets from answer 2. If desktop app only:
  "- Works only in the Claude desktop app. Hand them things they can click: a
  code block with a Run button, a link, a file." If they dictate: "- Dictates,
  so names and technical words are sometimes misheard. Assume the most likely
  meaning and carry on."
- `{{LEARNING_RULE}}`: if yes to 3, this bullet, else delete the line:
  "- Every final answer that did real work carries one short \"Worth knowing\"
  (two or three sentences): the most transferable idea behind the work, a
  principle, trade-off or industry practice, and why it mattered here. Go
  deeper over time rather than defining basics."
- `{{PUBLISH_RULE}}`: if yes to 4: "- Standing authority: when {{NAME}} asks
  for a change to one of their own apps, sites or tools that has an established
  live destination, finishing it includes publishing the verified result there,
  without asking again. Use the `verified-deployment` skill. Still ask when the
  destination is unclear, and before messages to other people, purchases,
  deleting data or accounts, or anything irreversible they did not ask for."
  If no: "- Ask before publishing, deploying or pushing anything live, before
  messages to other people, purchases, deleting data or accounts, or anything
  irreversible."
- `{{COMMIT_FOLLOWUP}}`: if yes to 5, `, commit and push`; else empty.
- `{{GIT_RULE}}`: if yes to 5: "- Commit and push verified work without
  asking. Stage explicit paths. Author commits as `<email>`. Force-push, history
  rewrites and other people's repos need a yes." If no: "- Commit only when
  asked. Stage explicit paths. Force-push and history rewrites need a yes."
- `{{MACHINE}}`: one line you detect, e.g. "Windows 11, 16 cores, 32 GB RAM."
  or "macOS 15 on Apple silicon, 10 cores, 16 GB RAM." Windows:
  `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption; (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors; [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB)"`.
  macOS: `sw_vers -productVersion; sysctl -n hw.ncpu; echo $(( $(sysctl -n hw.memsize) / 1073741824 ))`.

If `~/.claude/CLAUDE.md` already exists, do not overwrite it. Show the person
what the kit would add, and merge only what they agree to.

**Done when** `~/.claude/CLAUDE.md` exists and contains no `{{`.

## 4. Install the core

    node "$HOME/claude-setup/scripts/install.mjs" --dry-run <flags>
    node "$HOME/claude-setup/scripts/install.mjs" <flags>

`<flags>` come from the interview: add `--auto-mode` if yes to 6, and
`--publish-authority=<GitHub user>` if yes to 4. Leave them out otherwise.

This copies the docs, the `reviewer` agent, the two safety hooks, five skills,
the frames tool and the Blender proxy into `~/.claude`, and merges
permissions, hooks, the auto-mode rules, the context window setting and the
mod marketplace into `~/.claude/settings.json`. It backs up anything it
changes.

Then install the media tools the `media-and-motion` skill uses, unless they
are already there (`ffmpeg -version`, `magick -version`):

| Windows | macOS |
|---|---|
| `winget install --id Gyan.FFmpeg -e` and `winget install --id ImageMagick.ImageMagick -e` | `brew install ffmpeg imagemagick` |

Python 3 is needed for the frames tool (`python --version` on Windows,
`python3 --version` on macOS); install it the same way if missing
(`winget install --id Python.Python.3.12 -e`, or `brew install python`).

Claude Code may refuse to let you run this yourself, because changing your own
permissions and hooks is something its safety check holds back for the
person. That refusal is correct. Hand them the second command in a code block
to run themselves (the desktop app shows a Run button), then continue.

**Done when** the installer prints `Done.` and lists what it changed.

## 5. Mods and plugins

    claude plugin marketplace add tristanmuzzu/claude-mods
    claude plugin install session-map@tristan-mods --scope user
    claude plugin install working-dot@tristan-mods --scope user
    claude plugin marketplace add remotion-dev/claude-code-plugin
    claude plugin install remotion@remotion --scope user

Skip `plan-meter`; it is retired. If `claude` is still not on PATH, give the
person the same lines as slash commands to type in a chat (`/plugin
marketplace add tristanmuzzu/claude-mods`, `/plugin install
session-map@tristan-mods`, and so on).

**Done when** `claude plugin list` shows `session-map`, `working-dot` and
`remotion` as installed and enabled.

## 6. Optional apps

Ask which of these they want, showing only the ones their OS supports:

| App | What it is | Windows | macOS |
|---|---|---|---|
| Parakeet Dictation | Local voice dictation into any text field, Ctrl+Win, no subscription | yes | no build yet |
| Pipsqueak | A desktop pet with one status card per chat | yes | untested; skip unless they ask |
| claude-brainrot | Small gameplay overlay while Claude thinks | yes | plain window only; skip unless they ask |
| Blender MCP | Lets Claude drive a running Blender | yes | yes |

For each one they pick, follow that project's own agent guide. Each repo has
`AGENTS.md` and `INSTALL.md`; read them and do what they say:

- Parakeet: https://github.com/tristanmuzzu/parakeet-dictation. Use default
  Parakeet recognition, preserve existing shortcuts, verify a sentence lands in
  a plain text editor, and ask before enabling login startup.
- Pipsqueak: https://github.com/tristanmuzzu/Pipsqueak-Agent-Pets. Prefer the
  latest release, preserve existing hooks, verify a real conversation reaches
  the pet, and ask before enabling login startup.
- claude-brainrot: https://github.com/tristanmuzzu/claude-brainrot. Use the
  source version, preserve existing hooks, and verify a demo before enabling
  the overlay for Claude Code.
- Blender MCP (needs Blender 4.2 or newer and Python 3.10+):
  1. In Blender: Preferences, Get Extensions, Repositories, add
     `https://lab.blender.org/`, then install and enable the MCP add-on. The
     person does this; tell them the clicks.
  2. Make the server's venv and install the pinned release:

         python -m venv "$HOME/.claude/blender-mcp/.venv"
         # Windows: "$HOME/.claude/blender-mcp/.venv/Scripts/python" ...
         "$HOME/.claude/blender-mcp/.venv/bin/python" -m pip install "git+https://projects.blender.org/lab/blender_mcp.git@v1.0.3#subdirectory=mcp"

  3. Register the lazy proxy, which shows one `blender_activate` tool until a
     chat needs Blender, so other chats stay lean:

         claude mcp add --scope user blender -- "<venv python>" "$HOME/.claude/bin/blender-mcp-lazy.py"

     `<venv python>` is `.../.venv/bin/python` on macOS and
     `.../.venv/Scripts/python.exe` on Windows, as an absolute path.
  4. Verify: with Blender open, a new chat calls `blender_activate` and then
     lists the scene's objects.

Also recommend, without installing anything: the Claude in Chrome extension
from the Chrome Web Store, which lets Claude use their real browser.

macOS has no Parakeet build. Point Mac users to the built-in dictation
(System Settings, Keyboard, Dictation; then press the dictation key or Fn
twice) as the stand-in.

**Done when** every app they picked passes its own guide's verification, or
you have reported exactly why it did not.

## 7. Verify everything

    node "$HOME/claude-setup/scripts/verify.mjs"

Every line must be PASS. WARN lines about mods are expected until the app
restarts. Then ask the person to quit and reopen the Claude app, open a new
chat, and confirm two things they can see: the session-map side pane, and a
green dot on the chat title in the sidebar while you work.

**Done when** `verify.mjs` reports all required checks passed and the person
confirms the pane and the dot.

## 8. Report

Tell the person, in plain words:

- what was installed (rules, skills, hooks, mods, each optional app);
- what was skipped and why (for example: no macOS build);
- where the backups are (`~/.claude/backups/claude-setup-<time>/`);
- how to update later: say "update my claude-setup" and the agent runs
  `git -C "$HOME/claude-setup" pull`, the installer, and `verify.mjs`.
