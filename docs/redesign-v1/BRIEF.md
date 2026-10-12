# Redesign v1: graph, detail pane, legend

Status: built. This brief was corrected to as-built where the code came out differently; the record of the redesign, with the functions and constants that hold each rule, is the last section of `docs/SPEC.md` ("Redesign v1: graph, detail pane, legend"). Still open from "How the work is split": the last of P4's dead-code removal.

The brief every engineer on the redesign worked from. The two PNGs beside this file are the look that was aimed for; they are a guide, and where this brief differs, the brief stands. Background on the mod and the engine: `docs/SPEC.md`, `docs/API-NOTES.md`. Rules for agents: `AGENTS.md` (no tests).

## What we are building

The designer becomes a near-fullscreen workspace for an engineer: a **graph** of the workflow on the left, a **detail pane** on the right, a **header** above, and a **footer** whose right half is a **key legend**. The left hand rests on WASD.

Principles, in order:

1. **The graph is the product.** Typed boxes, arrows down the flow, arms side by side. It always fits the width it has: nothing pans sideways.
2. **One key, one action.** Every graph action is a single key. The legend never names a key that would not work right now.
3. **The screen holds still.** Header, graph, detail pane and footer keep their places and sizes. Only their contents change.
4. **Nothing is lost.** Everything round 3 and 4 won stays: undo/redo, typed text always saved, changes announced, run lock.
5. **The pane says who has the keyboard.** As built it says so in words only when it has not: while the keys are in the prompt the legend and the key hints are dim and the footer's message row says `Input: prompt · click the graph or /conductor`. With the keyboard, no row names its place (the brief's words for the graph and for the details were taken out): the keys named in the legend and in the hints say it.

Non-goals for v1: the left-to-right flow (deleted: top to bottom only), compact mode `z` (deleted: nested views replace it), a "Target" row in the header, vector rendering, the run-only phase view (`hooks/run.tsx` stays as it is).

## Engine facts found for this redesign (2.1.296, probed live)

- **A Button hotkey cannot see Shift.** `Shift+j` pressed the `j` hotkey; `ui.press` carries no key.
- **A focused `Input` sees every printable key, case kept.** A pane opened with `focus: true` and an `Input` with `autoFocus`: `ui.input` got `w`, `W`, `s`, `D`, `+`, `?`, `1` as one `change` each, and Enter as `submit`. A Button's hotkey does not fire while the ring is on the Input. A burst sent at once arrived as a single `change` with all the characters (`wasdWASD`).
- **The field is emptied by re-keying it.** Answering `{ element, value: '' }` did not clear what was typed. Drawing the Input under a new `key` (`keys:<n+1>`) with `value=""` after each input did: the ring stayed (it is kept by place among the stops), the field was empty, the next key arrived alone.
- Up / Down on the Input walk the ring (a `ui.focus`, origin `person`, no key told). Left / Right / Backspace stay in the field. Tab goes to the next stop.
- A clicked `Client` gets `{ key: 'W', shift: true }`, arrows, `tab`, `return`, but nothing can focus a Client without a click, and nothing says when it loses the keys. So, as since round 3, **the Client never keeps the keyboard**: after a click the hooks take it back for the pane.
- The dock's width is the person's once they dragged it (kept in `~/.claude.json`); the mod's `columns` is only a request.

- Found during the build: a key typed in the frame an Input is drawn under a new key is dropped; a reused key brings back its old text (keys carry a per-load stamp); changing `value` under a focused Input leaves the cursor where it was; a focused Input wraps only at the pane's full body width; an engine stop (the pane's ✕) sits before the mod's first; `ui.scroll` carries the wheel with the pointer's cell; an `Input` under a `display="none"` Box stays a focus stop and takes keys while the terminal's cursor is hidden; a focused Input pushed off-screen or clipped still has its cursor shown, clamped to the screen's edge.

**Consequence: the key catcher.** The ring rests on one tiny `Input` (the catcher), not on a Button. Every key the person types while the ring rests there is one character of a `ui.input`; the hook maps it to an action and the pane redraws. As built the catcher is the frame's first child under a `display="none"` Box: a focus stop that is not drawn, so no cursor blinks at rest. It is not re-keyed per key (a key typed in that frame would be dropped): its whole text is read each time and it is emptied only once it holds more than 40 characters and the typing has paused. A second small Input, the door, is the stop after it: the person's Tab lands there and that opens the fields. This is what makes `Shift+WASD`, `+` and `?` possible, and it replaces the hotkey Buttons, the pinned-ring rewrite onto `c: help`, and the `prompt.edit` swallow of unbound letters.

## Screen

Docked and at least 100 body columns wide ("wide"):

```
conductor / research-answer                                        EDITING · saved
Goal  Answer a question from many sources: search, read, check gaps, write up.
────────────────────────────────────────────────────────────────────────────────────
┌ graph ───────────────────────────────────────────────┐ │ AGENT / Search          n2
│  (breadcrumb row here only inside a nested view)     │ │ ──────────────────────────
│                                                      │ │ Meaning …
│                                                      │ │ problems, fields, type
│                                                      │ │ …
│                                                      │ │
│                                                      │ │ [Enter] Edit  [i] Hide
────────────────────────────────────────────────────────────────────────────────────
agents ≥ 12                                       [WASD] Navigate  [Shift+WASD] Move  [n] New  [x] Delete
Last change: n5 changed: notes · [u] Undo         [o] Open  [b] Back  [u] Undo  [g] Goal  [r] Run  [?] Help
```

(A sketch of where the parts stand, not a capture. As built: the rule under the header rows, the keys of the detail pane on its last row, the agent count alone at the footer's left.)

- **Width asked of the dock:** the terminal's columns less 30 when known (the transcript keeps a sliver, the prompt stays full width). A kept width still wins.
- **Detail pane width:** about 30% of the body, at least 38, at most 52. A rule between it and the graph (three cells: ` │ `). `i` hides it (the graph takes the width; as built the hidden pane has no row at all, and the footer names `[i] Show details`) and shows it again.
- **Header, row 1:** `conductor / <design name>` left; right the state: `EDITING · saved` / `EDITING · unsaved template` / `EDITING · not saved yet` / `EDITING · replay, not saved` / `RUNNING · 5/9 agents done · 57.4k tokens · 12s` (in fewer words where it is narrow) / `FINISHED · …` / `DRAFTING` / `START · …` (the start screen). **Row 2:** `Goal  <description>` (dim `not said yet · g sets it` when empty), wrapped to at most 2 rows (1 inline). As built a rule as wide as the pane stands under these rows in every docked layout (not inline).
- **Footer, left:** row 1 the design's facts; row 2 what was last said (the message row: a change and `[u] Undo`, a refusal, a question, the run lock). As built the facts are the agent count alone, with an operator: `agents = 18` when every count is stated, `agents ≥ 12` where one is open; the block count and the problem count the brief asked for are not shown. **Footer, right:** the legend, two rows, right-aligned, plain `Text` (not Buttons), each key in the accent colour in brackets and its word after. Keys that cannot work now are left out; the ones shown keep a fixed order. As built the legend also names the selected block's chips (`[1] Model  [2] Effort  [3] Votes`), `[u]`, `[y]`, `[g]`, `[q]`, `[c]`; where its rows cannot hold them all, those less-used entries are left out (the help page has every key). As built no key is named twice: the footer's legend holds the graph's keys and the pane's own, and the keys of the detail pane stand on that pane's last rows (`[Enter] Edit  [i] Hide` at rest; a field's, the add list's, the goal's, a help page's, the start screen's list's). While the ring is in a field, the add list or the goal the footer names `[Esc] Keys to the prompt` alone; with the detail pane hidden it names `[i] Show details`. Tab is not named in the legend (it still opens the fields; the help page says so). While the pane does not hold the keyboard the legend is dim and row 2 of the left side starts with `Input: prompt · click the graph or /conductor`.
- **Stacked** (docked under 100 columns, or inline above the prompt): the same parts in one column: header, graph, detail pane under it, footer (the legend under the facts: three rows docked, one inline; as built the docked footer is two rows in every layout, the legend at the right of the facts as when wide). Same keys, top-to-bottom graph. As built the detail pane at rest has about 45% of the rows docked and, inline, only its last row (its key hints); it grows while a field, the add list, the goal or a help page is open. It must work and not lose anything; it is not where the polish goes.

## The graph

Top to bottom only. Drawn by the `Client` from a pure layout and a pure paint, as now. As built it is laid out at most 132 columns wide (`GRAPH_MAX_W`) and centred in a wider region.

### Cards

```
╭───────────────────────────────────────────── n2 ─╮
│ AGENT / Search                         haiku low │
│ Find relevant sources.           output: sources │
╰──────────────────────────────────────────────────╯
                         ↓  [+]
┌─ PIPELINE / Deep read ×4 · each: deduped sources ──────────── !  n4 ─┐
│ ╭───────────────────────────────────────────────────────────── n5 ─╮ │
│ │ AGENT / Read source                              sonnet high │ │
│ │ Extract claims with evidence.   output: claims + quotes + c… │ │
│ ╰──────────────────────────────────────────────────────────────╯ │
│                                ↓  [+]                               │
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ n6 ━┓ │
│ ┃ VERIFY / Check claims               1 sonnet  2 high  3 votes 2 ┃ │
│ ┃ Try to refute the claims.            output: verdict + reason ┃ │
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
└──────────────────────────────── [+] ─────────────────────────────────┘
```

- **Leaf** (a block that holds none): light rounded border in `subtle`. Row 1: `TYPE / Title` (the type in capitals in its accent colour, ` / ` dim, the title bold; the title is left out while it is still the type's name; `×N` after it for a leaf that fans out); at the right what is set of `model effort`. Row 2: the first line of its notes (its prompt when it has no notes), dim; at the right `votes N ·` and `output: <schema>`, cut with `…`. A leaf with nothing for row 2 is three rows tall. Its id is dim on the top border, right.
- **Missing but needed** is said in place, in `error`: `Instruction [not set]` (an agent with neither notes nor prompt), `Stop [not set]` (a loop with no `until`), `IF [not set]` (a branch arm with no condition).
- **Container** (holds blocks): square border in the type's accent colour. Its header is on the top border: `TYPE / Title`, then `×4` (bold), then what fits of `· each: …`, `· until: …`, `· count unknown` (when the fan-out states no number), and a carousel's `· 2–4 of 9` last; at the right the problem mark and the id. Knobs that do not fit the header are in the detail pane only. An empty container holds one row: as built it says `empty`, and the container's `[+]` is on its bottom border.
- **Selected:** heavy border in `claude`, title still bold. A selected leaf grows to show all its notes, wrapped (up to a third of the graph's rows, at most 8), and its row 1 shows the **chips** (see keys `1 2 3`): each quick knob with its digit and its value (`2 low`, `3 votes 2`); an unset one shows the knob's name, dim (`1 model`), not `inherit`. Chips that do not fit beside the whole title take a row of their own. A selected container that has quick knobs (sweep, loop-until-dry) carries them on its top border. No chips while a run locks the design.
- **Problem mark:** as built a bare ` ! ` (no count), inverse in `error`, on the top border directly left of the id, on every card, leaf and container alike. It marks a block that has a problem of its own; a collapsed container carries it too when a block inside it has one. No problem count is shown anywhere in the pane. (The brief had ` !N `, at the right end of a leaf's row 1.)
- **Arrows:** one row between two blocks of a chain, the arrow centred on the list: `↓` hands each result on as it arrives; `⇓` waits for all results (the old barrier), with a dim ` all` after it.
- **`[+]`:** two cells right of the arrow between two blocks of a chain. As built every `[+]` is always drawn (the brief showed only those around the selection, the rest when pointed at), and the label is `[+]` everywhere: at the end of any container's list, a chain's or a stack's, it is centred on the container's bottom border; at the end of the top level it has a row of its own, centred under the arrows; an empty container says `empty` and has its `[+]` on its bottom border; an empty design shows a bare `[+]` over its hint lines. At rest a `[+]` is faded. The active one is yellow and bold (theme key `warning`): the place `n` would add at right now, and the one under the pointer; none is lit for `n` while the pane does not hold the keyboard. A slot whose add list is open reads `[+] Add block here`.
- **Run results** stay on the bottom border, left, as now (`✓ 4/4 done · 40.8k`); a block a finished run never reached is dim with `not run`.
- **Marks at the edges:** `▲ N more above` / `▼ N more below` on the graph's first / last row; a container whose header has scrolled off keeps it on the first row. Unchanged in meaning from the flow board.

### Chains and stacks

- `pipeline`, `loop`, `loop-until-dry` and the top level are **chains**: their blocks one under the other, every block as wide as the list.
- `parallel`, `sweep`, `branch` are **stacks**: their blocks (arms) side by side, equal widths, tops aligned. Between two arms the word `OR` (`branch`) or `∥` (`parallel`, `sweep`), on the arms' second row. No arrows between arms.
- **A branch's arms say their condition.** New knob `when` (text) on a block that stands directly in a `branch`. It is drawn on the arm's top border, left: `IF <when>`; the last arm with no `when` reads `ELSE`; any other arm with none reads `IF [not set]` in `error`.
- **Too many arms for the width (the carousel).** An arm is never narrower than `ARM_MIN_W` (28). A stack whose arms do not all fit shows as many as fit between two 3-column gutters (as built both are kept; the mark is drawn only on a side that has more): `◀` with the count hidden on that side under it, `▶` likewise, in `claude`. The header adds `· 2–4 of 9`. The window always holds the selected arm (moving the selection with `a` / `d` past the edge slides it by one); a click on a gutter slides by one. As built a slide that would take the selected arm out of the window moves the selection to the stack itself, so that rule holds. The slide is tweened like any card motion.

### Nested views

- **A container that cannot be drawn open is drawn collapsed**: when it stands more than `OPEN_DEPTH` (3) containers deep below the view's root, or when the room inside it would be under `OPEN_MIN_W` (34) columns. Collapsed, it is a card the size of a leaf (four rows): row 1 `▸ TYPE / Title` and at the right `N blocks` (all it holds, at any depth); row 2 the titles of its blocks joined by ` → ` (a chain) or ` | ` (a stack), cut with `…`, and at the right `o: open`. Both limits are named constants.
- **`o` opens a container as the view**: any container, collapsed or not. The view then shows only that container, as the frame, at full width, and its inside laid out by the same rules (so deeper ones may open now). The first row of the graph is the **breadcrumb**: `research-answer › n4 Deep read › n9 Close gaps`, the last crumb bold, each crumb pressable. `b` goes one level up and selects the container it came out of.
- The selection never leaves the view by navigation. When something else must show a block outside it (a run following, an edit from chat, undo), the view changes: as built it stays when it already draws the block, else goes to the root when that draws it, else to the outermost container that does (not the innermost).

### Navigation and moving (pure functions over the design and the layout)

- `s` / `w`: next / previous block in reading order of the chain: from a container down into its first block, from the last block of a container on to what follows the container, `w` from a first block up to its container. Inside an arm they stay in that arm until its end.
- `d` / `a`: in a stack, the arm to the right / left (the block of that arm nearest in height). Elsewhere `d` goes into a container (its first block) and `a` out to the container around the selection.
- Nothing wraps. At an edge nothing happens (no message). With nothing selected, any of the four selects the view's first block.
- `Shift+S` / `Shift+W` move the selected block one **place** down / up in reading order: past a sibling, into an open container that comes next (as its first block), out of the end of its own container (to just after it). `Shift+D` / `Shift+A` swap it with the arm to the right / left; outside a stack they do nothing and say `only arms move sideways`. Every move is one undo step and is announced as now (`moved n7 into n4 · [u] Undo`). As built a move with nowhere to go says why (`already at the bottom`, `already the last arm`, `already at the bottom of this view: b goes up a level`), and a block never leaves the view.
- A collapsed container is one place: nothing moves into it by keys (open it first).

## Keys

One model. Letters are typed into the key catcher while the ring rests on it (no field is open).

| Key | Does |
| --- | --- |
| `w` `a` `s` `d` | move the selection |
| `Shift+W/A/S/D` | move the selected block |
| `Enter` or `e` | edit: the ring goes to the first field of the detail pane |
| `Tab` | the same field, by the ring's own step: it lands on the door, which opens the fields |
| `n` or `+` | new block after the selection (inside it when it is an empty container): the detail pane becomes the add list. Pressing `n` again there cycles the place: after, inside (a container), before. On the view's frame it starts inside |
| `x` | delete (a container that holds blocks asks: `x` again). As built it also closes the add list and the help pages |
| `1` `2` `3` | on the selected block, step its quick knobs: `1` model (inherit → haiku → sonnet → opus → inherit), `2` effort (inherit → low → … → max → inherit), `3` votes (verify, judge panel: 1…5). Only the ones its type has. Each is an undoable edit, announced. As built `3` steps votes only: the worktree toggle on an agent was taken out |
| `o` / `b` | open the selected container as the view / back up one level |
| `i` | hide / show the detail pane |
| `u` / `y` | undo / redo |
| `g` | edit the goal |
| `q` | ask Claude to review the design (fills the prompt, the keys go there) |
| `r` | run: fills the hand-off request (the keys go to the prompt) |
| `c` | clear the results of a finished run |
| `?` or `h` | help, four pages, in the detail pane: a page a press, round again; `x` closes |

- A character that is no key says `k is not a key here` and nothing else happens. A paste (more than 8 characters at once) is ignored and says so. A burst of up to 8 is applied in order.
- As built there is no `p`: "next problem" was taken out with the problem counts, and `p` is no key (`p is not a key here`).
- While a run locks the design only `w a s d o b i ?` act; the legend shows only those. (`c` is for a run that is over: while one runs it answers with the lock.)
- In a field: Tab / Shift+Tab walk the fields and the type picker, Enter saves and returns to the graph, Shift+Tab from the title returns to the graph too, Escape hands the keyboard to the prompt (the text is saved, as since round 4).
- The mouse keeps what it has: click selects, a click on `[+]` opens the add list there, drag the selected card to move it, drag elsewhere pans up and down; new: a click on a crumb, on a carousel gutter, on a chip (steps it), a click on the container that is already selected opens it (not a double-click: there is no timing), a click on a field at rest opens the fields on it, and the wheel scrolls the graph (`ui.scroll` over the graph's rows).

## Detail pane

One column of labelled sections, each label in the accent colour on its own row, a thin rule between sections. It shows, for the selected block:

1. `TYPE / Title` and the id.
2. **Meaning**: the type's one-line hint and its `use when`.
3. **Problems** (when the block has any): each as `Error` (what is wrong) and `Fix` (how to fix it): the two halves of the lint's message.
4. **The fields** its type has, in this order: title, notes, prompt, `when` (an arm of a branch), fanout, until, schema, agentType; each label above its value, the value wrapped at rest (`[not set]` dim, or in `error` where a problem names it). As built a field being edited is one line (the engine wraps a focused Input only at the pane's full width) with its whole text drawn wrapped under it.
5. **Pickers**: type (opens the add list as a list of types), model, effort, isolation, votes, one to a row. As built only `Type … ▾` is there: the card's chips step the model, the effort and the votes, and a block that carries `isolation: worktree` shows a read-only `Isolation  worktree` line (the knob stays in the file format and the hand-off, for Claude to set).
6. **Run** (while results show): the block's agents, as now. While a run locks the design there are no fields and no pickers.
7. Pinned to the pane's last rows: as built the keys of the detail pane. `[Enter] Edit  [i] Hide` at rest; in a field `[Tab] Next field  [Shift+Tab] Previous  [Enter] Save, back to the graph`; the add list's keys; the goal's; a help page's `[? h] Next page  [x] Close help`. Nothing else is pinned there: no next-problem key, no row for the selection and the keyboard's place, and the key catcher is on no row (it is not drawn). Hidden with `i`, the pane takes no rows. (`Problems N · Blocks N` was not built, and neither count is shown anywhere.)

The same pane, in place of 2–6, shows the **add list** (the filter field, then every type with its hint, `w`/`s` or typing to choose, Enter adds, `x` cancels; its heading says the place, `New block after n4 Deep read`, and the pane's last row says `[n] Change place`), the **help pages**, and the **goal** field. With nothing selected (an empty design) it shows the design's goal and how to start.

## Start screen (not in the first brief; added during the build)

Opening the designer with no design (`/conductor design`, or a name no design has) shows the same frame: the detail pane lists the saved designs and, under them, the templates and Blank, one row each, the marked one with `▸`; the graph draws the marked row's design read-only; the header shows its name, `START · …` and its goal. `w` / `s` move the mark, Enter or a click opens the row, `?` is help. As built the detail pane's last row names the list's keys (`[w s] Choose  [Enter] Open`), the footer's legend `[?] Help`, and the footer's left says `1 saved design · 4 templates`. It replaces the template picker.

## How the work is split

- **P1A, graph engine (pure, new files):** `src/ui/graph-layout.ts`, `src/ui/graph-paint.ts`, `scripts/render-graph.ts`; the `when` knob in the model. The flow board's modules stay untouched and in use until P2.
- **P1B, the shell:** the key catcher and the key model, the wide split screen, header, footer and legend, the detail pane, the add list in it; on the old board for now.
- **P2, integration:** the Client on the graph engine; nested views, breadcrumb, carousel, chips, moves by key, the wheel, run overlay, `when` in lints, teaching, the chat tool and the hand-off.
- **P3, polish:** rounds of live review.
- **P4, clean-up:** dead code out (the flow board, the horizontal flow, compact), README / PRODUCT / SPEC / API-NOTES brought up to date.
