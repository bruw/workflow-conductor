# Backlog

One line per ticket. Opened after the entry-point work (the `before_workflow` offer, visualizing a design-less run, the script beside the design).

1. Keep which design a run belongs to, the pending handoff and the offered draft in one place that survives both a hot reload and `/clear` (today split between module memory and `$.state`, so `attach` refuses after `/clear` or a rename and the offer can ask mid-handoff after a reload).
2. Ask "Visualize this run?" without holding the turn: the tool result and the run's completion notice wait for as long as the dialog is up.
3. A retry of a handed-off design's script under another workflow name, or after the user answered a question of Claude's, is not saved over the design's script: decide by the run's origin, not by name and timer.
4. A run that starts takes the board to its design even while another design is being edited: keep the edited design and say where the run is shown.
5. Show and edit a block's `match` on the board (today only Claude sets it and only the design file shows it).
6. Exercise in a real session what was only reasoned or run under a fake host: the offer, visualize and handoff flows again on the `start` block model they were merged with, a retry after a failed script, a first run after the claim expired, a chat approval through to its run, the stored Always/Never answers of both questions, typed and dismissed answers to the Visualize question, `/resume`.
7. Bring `tests/` back to compiling and cover the tracker's claim rules and the reducer's matching, or delete it: nothing automated guards them.
8. Give each dev session its own tmux session name and debug log by default: two sessions in one checkout kill each other and can type into each other.
9. Shorten the design tool's description (4,087 of the 4,096 characters it is cut at): the next field added will not fit.
10. One ask-and-keep helper for the two questions, and one record per design for what Claude has seen (`seenByClaude`, `seenDesigns`, `warnedAt` are kept in step by hand).
