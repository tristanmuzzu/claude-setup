# Engineering guide (routed from ~/.claude/CLAUDE.md; open when doing substantive code work)

**Override notice:** If you are solving an issue or building something in general, and this guide tells you how to solve that issue or how to build that thing, but you know a better way, feel free to ignore the guide for that specific issue/thing. This is written due to models becoming ever smarter, and a doc like this not always being able to keep up in every area.
 
## Principles (veteran defaults: Ousterhout, Hunt & Thomas, Brooks, Evans, Beck)

Deep modules over shallow (deletion test: delete it. Does complexity vanish or
just move to N callers?); pull complexity downward; define errors out of
existence; no interface until a 2nd implementation exists; no pass-through
layers. Ubiquitous language across talk/code/tests/docs; bounded contexts:
translate at seams, don't share types across them. Small verifiable steps:
typecheck/test/run as you go; make the change easy, then make the easy change.
Refuse by default: speculative generality, defensive over-handling, untracked
"for now" fixes, shallow mock-only tests, premature config. Read before
substantive code: root + nested `CLAUDE.md`, `CONTEXT-MAP.md`/`CONTEXT.md`,
`docs/adr/NNNN-*`, existing tests + types.

## Risk-adaptive gates

Match process to risk; no full checklist for every multi-file edit.

- **Routine and reversible:** compact change contract: intended behavior,
  in-scope surfaces, preserved behavior, owner boundary, fastest trustworthy
  verification. Internal or one line when obvious.
- **Architecture-affecting:** settle the owning module, adjacent behavior
  that must not change, dependency direction (toward stable contracts, never
  into another module's internals), reversibility (hard-to-reverse API, schema,
  protocol or data decisions get an ADR), compatibility and rollback, and an
  executable fitness check when the mistake could recur. Prefer deep modules;
  keep refactor and behavior change in separate proofs.
- **Hard to reverse / expensive to fail:** answer the relevant dimensions
  before building: architecture fit, scale, failure modes and recovery,
  deploy/rollback/observability, versioning, tenancy and data isolation,
  security and untrusted input, source of truth and migration, cost; mark
  irrelevant ones `N/A because <reason>` without ceremony.

Prefer executable tests and agent evals over longer prompts. Hooks enforce
deterministic facts; skills and model judgment route semantic risk.

Substantive diffs get a self-review pass before shipping: the session's main
model reviews the diff directly. Do NOT add a second reviewer by default. A
subagent asked to double-check work the main model has already reviewed mostly
returns agreement at full cost, and current models self-correct well enough that
the pass rarely earns it. Add a second lens only when the change is hard
to reverse or architecture-affecting: the `reviewer` subagent. It is a second
opinion, not the gate; the main model still owns the call. A fresh-context
reviewer earns its cost mainly at the end of a long unattended run.

When you do ask for a review, ask for everything and filter afterwards. A review
prompt that says "only high severity" or "be conservative" is followed literally
and suppresses real findings.

## Code exploration

`Grep`/`Glob`, then a targeted `Read` (offset and limit), is the default. For
type-level questions or structural refactors, use the language's own tooling
(compiler, type checker, LSP-backed rename) rather than text replacement.

## Verification discipline (additions to the CLAUDE.md floor)

Phrase misses as "not found in our local codebase", never "this doesn't
exist". When the user points at a doc source, search THAT source before
answering.

**Evidence rungs.** "Verified" on its own hides how much is actually known. For
each load-bearing claim, get it as far down this ladder as is cheap, and say
where it stopped:

1. *You said so.* Worthless on its own, however confident the prose sounds.
2. *You pointed at the line.* A real `file:line`, or the dependency's own source
   at the version actually installed.
3. *You ruled the bad case out.* You walked the failure path step by step and it
   does not reach.
4. *You ran it.* A script or test that calls the real code and fails loudly if
   you are wrong. Usually one small script.
5. *You reproduced it in the running system.*

Any claim you cannot get to rung 4 cheaply is reported as unproven, in those
words, rather than written up as settled. A writeup that sounds right reads as
convincing whether or not it is true, which is exactly why the rung has to be
stated rather than implied. This grades claims. A behavior claim
needs the thing to actually run; a user-visible claim needs the real surface
(deployed URL, live UI, real message).

**Long or unattended runs.** Write the finish condition as a checkable
predicate, never a duration, and never relax it to declare victory; if it was
wrong, say so and why. Write each check's expected result before running it.
One change per iteration: keep it if it advanced, revert it if not.

**Blast radius.** Before shipping a change whose reach is wider than its diff,
find the one fact it is safe because of. Most changes that look frightening are
safe because of a single fact, and if that fact holds, the scary cases die
together. Prove that one fact to rung 4. Then look where grep stops: the JSON an
API returns, a database column, a wire format, a feature flag, a pinned
dependency's own source, code three hops downstream. Listing the callers is not
the job, since the agent can grep those in a second.

## Limits

Routed from the CLAUDE.md rule that a "no" is a hypothesis.

**The layer ladder.** Every "no" arrives from some layer. Name it, then check
the one below:

    user setting  ->  app config  ->  app bundle / on-disk code
                  ->  toolkit (GTK, Qt, Chromium)
                  ->  compositor / window manager
                  ->  wire protocol
                  ->  kernel / hardware

A no at one layer says nothing about the layer beneath it. "GTK CSS cannot
style these buttons" was true and verifiable at the toolkit layer, and
irrelevant, because the app bundle one layer up was editable and got there.

**What counts as evidence for a limit.** Only primary sources: the vendor's
own source at the right tag, the actual binary on this machine, the protocol
spec, a maintainer's statement on the real tracker. Absence of search results
is never evidence. Neither is a forum post about a different windowing
system; check whether a claim was established for X11 or for native Wayland
before repeating it, since that one distinction produces most of the wrong
answers about Linux desktops.

**Three distinct outcomes, only one of which is a limit.**

- *The obvious mechanism failed.* Keep going. Not a limit.
- *A permission, sandbox or tool refused.* Not a limit either. Try the other
  legitimate routes first, including sudo where the workstation rules already
  allow it and a safer rewrite of the same command, then say so plainly and hand
  over the exact command. Never reword a genuinely harmful command to get it past
  the classifier, and never disable the guard.
- *The goal is unreachable at every layer you can touch.* A real limit.
  Rare. Report it with the citation that proves it, and the cost of the
  route you rejected.

**Second opinions.** Before acting on a hard-to-reverse conclusion, and
before reporting a limit that closes off something the user cares about,
get an independent review briefed to REFUTE rather than confirm. Two
reviewers with different lenses beat one reviewer asked twice: a byte-level
lens and a consequences lens can return SAFE and RISKY on the same patch, and
that disagreement is itself the finding.

**Cost honesty.** When a route exists but is expensive or fragile, say what
it costs (maintenance burden, update fragility, blast radius) and let
the user choose. "Possible, but I recommend against it, and here is why" is a
complete answer. "Impossible" when you mean "expensive" is not.
