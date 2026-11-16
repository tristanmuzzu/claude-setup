# claude-setup

My Claude Code setup, packaged so your own agent can install it on Windows or
macOS from an empty Claude Code. You get the working rules, the safety hooks,
the skills, the mods, and optionally the companion apps.

## Send your agent here

Open a new chat in Claude Code and paste this. It is the same prompt on
Windows and macOS:

> Set up my Claude Code from https://github.com/tristanmuzzu/claude-setup.
> Clone it, read AGENT-SETUP.md and follow it for my operating system. Ask me
> the setup questions in one go, keep anything I already have, and finish by
> running the verify script and telling me what was installed and what was
> skipped.

The agent will ask you six short questions (your name, how you like answers,
whether it may commit and publish without asking, whether to use auto mode). It will hand you a command
or two to run yourself, because Claude Code rightly does not let an agent
change its own permissions. At the end, you restart the app once.

## What you get

| Part | What it does |
|---|---|
| `CLAUDE.md` rules | How the agent works with you: finish and verify, short plain answers with a TLDR, ask only when it matters, honest about limits. Written for you from a template, then yours to edit. |
| `docs/` | Engineering guide (risk-based gates, evidence ladder, limits), subagent routing, notes for the current model. |
| `reviewer` agent | An independent second lens on a diff, for hard-to-reverse changes. |
| Safety hooks | `guard-irreversible` stops force-pushes, recursive deletes of real data, disk tools and similar before they run, in Bash and PowerShell. It never asks you to approve a command: it blocks and names a safer route, and the agent takes it. `autosave-git` snapshots your work before any git command that could lose it, and `safe-rm` makes deletes recoverable for 14 days. |
| Skills | `frontend-design`, `verified-deployment`, `wizard`, `cinematic-3d`, `media-and-motion` (record the screen and read it back as frames, so motion is judged from evidence). |
| Auto mode | Optional. A safety check approves routine actions instead of asking every time, tuned with the same rules I use; the hooks stay as a hard backstop. |
| Mods | `session-map` (a side pane: what Claude is doing, task list, git state) and `working-dot` (a green dot on busy chats), from [claude-mods](https://github.com/tristanmuzzu/claude-mods). Plus Remotion's plugin. |
| Optional apps | [Parakeet Dictation](https://github.com/tristanmuzzu/parakeet-dictation), [Pipsqueak](https://github.com/tristanmuzzu/Pipsqueak-Agent-Pets), [claude-brainrot](https://github.com/tristanmuzzu/claude-brainrot), and the Blender MCP. |

## Platform support

| | Windows 10/11 | macOS |
|---|---|---|
| Rules, docs, skills, reviewer | yes | yes |
| Safety hooks | yes (through Git Bash) | yes |
| Mods | yes | yes |
| Parakeet Dictation | yes | no build yet; use macOS dictation |
| Pipsqueak | yes | untested |
| claude-brainrot | yes | plain window only |
| Blender MCP | yes | yes |

## Not included, on purpose

- Anything tied to my machine or my work: Linux desktop automation
  (Deskwright; Windows and macOS have Claude's built-in computer use
  instead), my machine scripts, work MCP servers, my memory.
- No accounts, keys or tokens. You sign in to your own services.

## Updating

Ask your agent to "update my claude-setup". It pulls this repo, re-runs the
installer (which backs up anything it changes and never touches your
`CLAUDE.md`) and runs the verify script.

## Manual install

With Git and Node 18+:

    git clone https://github.com/tristanmuzzu/claude-setup.git ~/claude-setup
    node ~/claude-setup/scripts/install.mjs
    node ~/claude-setup/scripts/verify.mjs

Then write `~/.claude/CLAUDE.md` from `home/CLAUDE.template.md` and install the
mods (see step 5 of [AGENT-SETUP.md](AGENT-SETUP.md)).

## License

MIT, except `home/skills/frontend-design`, which keeps its own license
(`LICENSE.txt` in that folder), and `home/bin/frames.py`, taken from
[Deskwright](https://github.com/tristanmuzzu/deskwright) under Apache-2.0.
