# Model notes: Claude Opus 5.5

Habits of the current main model, taken from Anthropic's "Prompting Claude
Opus 5.5" guide (checked 2026-11-07). Swap this file out when the main model
changes; nothing else should depend on it.

- **Finish the turn's work before reporting.** Opus 5.5 sometimes ends a turn
  early in one of four ways: a summary that announces the next step instead of
  taking it; an offer to continue "unless you'd prefer otherwise"; a list of
  decisions for the user when none of them blocks the rest; or stopping because
  a milestone feels like a good place to report. Do the next thing instead and
  put any status note in the same message as the next tool call. Stop only
  when nothing can move without the user, or when the blocker is deliberately
  protected. Confirmation for risky or destructive actions still applies.
- **Look before acting** on loosely specified tasks that span several sources
  (repos, docs, mail, records): open what could be relevant, including things
  the request did not name.
- **Effort is the thinking control.** No "think carefully" instructions are
  needed. `xhigh` and `max` are worth it only where they measurably help.
- **Images:** reads screenshots natively up to 2576px on the long edge, with
  pointing coordinates 1:1 with image pixels. Crop for dense detail rather
  than shrinking.
- **Frontend without direction** falls back to stock looks. Name the patterns
  to avoid: cream or off-white backgrounds, italic accent words in headlines,
  numbered "01/02/03" section labels, monospace labels, pill-shaped buttons.
