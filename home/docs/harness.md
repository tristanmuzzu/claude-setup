# Harness

What the claude-setup kit installed, and how to keep it current. Source:
https://github.com/tristanmuzzu/claude-setup. `~/.claude/claude-setup.json`
records the installed version.

## Hooks

Both run before every Bash command, with Node. They never slow ordinary
commands down noticeably and never block on their own failure.

- `hooks/autosave-git.js`: before a git command that can throw away
  uncommitted work (`reset`, `restore`, `checkout`, `clean`, `stash`, `rebase`
  and similar), it commits the whole working tree, untracked files included, to
  `refs/harness/autosave/<time>` with a throwaway index. Your staged changes
  are untouched. Recover with:

      git log --oneline refs/harness/autosave/*
      git checkout <ref> -- .        # put the files back
      git switch -c rescue <ref>     # or take the snapshot as a branch

- `hooks/guard-irreversible.js`: a parser, not a pattern list. It reads the
  command the way bash or PowerShell would and blocks things that cannot be
  undone or that reach past this machine: recursive deletes of real data,
  force-push, history rewrites, disk and partition tools, publishing gists,
  piping unknown remote scripts into a shell. It reads the body of a script
  before that script runs. A fresh autosave snapshot lets it relax the git
  rules, because the snapshot makes those commands reversible.

  It never asks you to approve a command. Prompts that people approve
  without reading protect nothing, so a risky command is blocked instead,
  and the block names the safer route (for a delete, `safe-rm`; for an
  unknown install script, download and read it first). The agent takes that
  route itself. Only when nothing safer exists does it tell you the step and
  the exact command at the end. To get approval prompts back, set the
  environment variable `GUARD_ALLOW_ASK=1`.

- `bin/safe-rm`: the recoverable delete. `~/.claude/bin/safe-rm <path>` moves
  the path to `~/.local/share/claude-graveyard` (kept 14 days);
  `safe-rm --list` shows what is there and `safe-rm --restore <entry>` puts it
  back. Bash, so it runs in Git Bash on Windows.

The guard checks both the Bash tool (Git Bash on Windows) and the PowerShell
tool.

## Permissions

`settings.json` allows everyday read and build commands without a prompt and
denies a short list of destructive ones. The installer only adds entries; it
never removes yours.

If you chose auto mode, `permissions.defaultMode` is `auto`: a classifier
approves routine actions and holds back risky ones. `autoMode` in
`settings.json` tunes it (`$defaults` keeps Anthropic's built-in rules, the
other lines describe this setup: personal machine, hooks as the backstop,
what counts as egress). The agent cannot edit those rules itself; change
them by hand or with the `wizard` skill. `modelSettings` raises the point
where a long chat is compacted to 400k tokens.

## Mods and plugins

- `session-map@tristan-mods`: a side pane in the desktop app showing what
  Claude is doing now, its task list, each request as a short story, and git
  state per project.
- `working-dot@tristan-mods`: a green dot on a chat's sidebar title while
  Claude works in it.
- `remotion@remotion`: Remotion's own skills for code-made video.

Source: https://github.com/tristanmuzzu/claude-mods. Update with
`claude plugin marketplace update tristan-mods`, then
`claude plugin update session-map@tristan-mods` (and the same for
`working-dot`), then start a new chat.

## Companion apps (optional, installed separately)

- Pipsqueak, a desktop pet that reacts to your agents:
  https://github.com/tristanmuzzu/Pipsqueak-Agent-Pets (Windows, Linux).
- Parakeet Dictation, local voice dictation, Ctrl+Win on Windows:
  https://github.com/tristanmuzzu/parakeet-dictation (Windows, Linux).
- claude-brainrot, a small gameplay overlay while Claude thinks:
  https://github.com/tristanmuzzu/claude-brainrot (Windows, Linux).

None of the three has a macOS build yet.

## Skills

- `frontend-design`: visual direction for any UI work.
- `verified-deployment`: publish to the right target and prove the live result.
- `wizard`: a guided bash script for steps only you can do.
- `cinematic-3d`: cinematic 3D videos in code (Remotion and React Three Fiber).
- `media-and-motion`: screen recording, `bin/frames.py` contact sheets with a
  stutter measurement, and headless Blender, Manim and Remotion renders.

## Updating

Pull the kit again and re-run the installer. It backs up anything it changes to
`~/.claude/backups/claude-setup-<time>/` and leaves `CLAUDE.md` alone:

    git -C <kit folder> pull
    node <kit folder>/scripts/install.mjs
    node <kit folder>/scripts/verify.mjs
