# Model routing

## Topology

The session's main model is the orchestrator. It owns intent, product and
architecture decisions, decomposition, worker contracts, and final review, and
it chooses per task whether to execute inline or delegate. There is no
default-delegate mandate. The session default model lives in
`~/.claude/settings.json` under `model`, the file the launcher actually reads. It is
not set in `~/.claude/CLAUDE.md` and cannot be: prose cannot change a model, so
a guide that claims to set one is simply wrong.

**One worker pool: Claude subagents.**  Everything is either inline or a Claude subagent.

Work inline when direct grounding improves the result: exploratory reading,
design-sensitive edits, debugging where hypotheses shift mid-read, quick
verification gates (typecheck, lint, targeted tests), or when writing the
contract would cost more than doing the work. Reading the code yourself before
deciding is always allowed and often right, since direct grounding also produces
better worker contracts when you do delegate.

Delegate to a subagent when it genuinely helps:

- well-bounded, serializable execution where a written contract loses nothing;
- mechanical volume (bulk edits, long test loops, repeated verification);
- parallel independent read-only work, or writes isolated in worktrees;
- broad fan-out search where you only want the conclusion, not the file dumps;
- an independent review lens on work the main model produced.

Two things that are NOT subagent work, because a subagent adds latency and a
context round-trip for nothing:

- a long shell command (a build sweep, a test suite, an rsync). Run it with
  `run_in_background: true` and keep working. A background Bash job costs no
  tokens; a subagent babysitting it costs many.
- anything where you already know the file and the answer is one `Read` away.

## Claude subagent workers

Claude subagents are the worker pool, not a last resort.

- **Model:** subagents inherit the session's model, which is right for
  anything needing judgment. Pin a cheaper model (`sonnet`, `haiku`) only for
  mechanical volume where you have seen it hold quality. No model names
  belong in this file beyond those aliases; model habits live in
  `model-notes.md`.
- **Batch independent spawns into one message** so they actually run in
  parallel.
- **Keep working while they run.** `Agent` returns immediately by default; do
  the next thing that does not need the result, and step in when a subagent
  goes off track or is missing context. Wait only when your next action
  depends on what it returns.
- **Continue, don't restart.** `SendMessage` to a live agent keeps its context;
  a fresh `Agent` call throws that context away and re-reads everything.
- The main model reviews substantive diffs itself by default. A review subagent
  is an independent second pass, never the primary gate.
- Every subagent except `Explore` and `Plan` loads the `CLAUDE.md` files, so the
  safety floor travels with the worker and does not need restating in the prompt.
  Those two skip them by design and are read-only anyway.

## Worker Contract

Every delegation prompt must include detailed instructions on the goal and specific task at hand, along any other information it wishes to pass on to the subagent, and the following. The first line matters more than it looks: a worker that knows why the task exists and who the result serves connects it to the right facts instead of guessing the intent.

```text
Why this matters and who it is for:
Already decided:
What was already tried and failed:
Boundaries / permitted actions: 
Return shape: 
```

## Review, failure handling, and fallback

The main model checks the diff and the load-bearing evidence. It does not redo
every worker step when fresh evidence already proves it.

Failure handling:

- **Infra failure** (spawn error, sandbox, timeout): 2 consecutive means stop
  delegating, execute inline, and report.
- **Task-content failure**: `SendMessage` the same agent with a correction
  rather than restarting from scratch. Two bounded attempts failing on content
  for the same reason means stop retrying and go inline.

Never let parallel workers edit the same checkout. Concurrent writers need
`isolation: "worktree"` and explicit ownership of distinct paths. Worktree
teardown is `git worktree remove`, never `rm -rf`.

For publish or release work, use `verified-deployment`; target resolution and
production authorization happen before any external write.
