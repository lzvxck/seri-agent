# seri — monochrome

A monochrome palette and type system for the full-screen terminal UI, carried over from three
references and reduced to two colors: Anthropic's near-black/cream pair (`docs/DESIGN.md`),
Vercel's structural precision, and opencode's terminal density. Published as an artifact first
(interactive preview, kept for reference) before porting into the TUI itself.

## Palette — two colors, inverted, not four

`docs/DESIGN.md` already states the rule for the web surfaces: paper and ink are a pair, not a
hierarchy — the same two colors read backwards make the other mode. The TUI needs nothing more
than that. Dark mode isn't a second palette; it's the identical pair with the roles swapped, the
same thing `altScreen.ts` already does to the whole terminal on entry and reverses on exit.

Two supporting tones do the rest: `ink-soft` for anything secondary (hints, footers, the muted
part of a row) and `line` for every hairline that used to be a border. Both are ink and paper
themselves, just diluted — not new hues.

| Role      | Light     | Dark      | Notes                  |
| --------- | --------- | --------- | ----------------------- |
| Paper     | `#faf9f5` | `#141413` | Ground                  |
| Ink       | `#141413` | `#faf9f5` | 20.7:1 contrast · AAA   |
| Ink, soft | `#615e53` | `#b3afa1` | Secondary text          |
| Line      | `#ddd7c6` | `#38352c` | Hairline borders        |

**Constraint, not a suggestion.** `apps/cli/src/tui/theme.ts` is deliberately ANSI-16 only today
— `error: "red", warning: "yellow", accent: "cyan", muted: "gray"` — no hex, no truecolor, by an
explicit research-spec decision. This system fits inside that rather than fighting it: paper and
ink read as the terminal's own default foreground and a reverse-video block, `ink-soft` *is* just
`gray`, and there's no accent hue left to assign — that's the palette's whole point, not a gap in
it.

## Type — two faces, one voice each

Sans carries prose (documentation explaining itself). Everything the terminal actually renders
goes in monospace, because past that point the font stops being a choice — the user's own
terminal face is the only one that ships.

| Role   | Face | Sample                                             |
| ------ | ---- | --------------------------------------------------- |
| Prompt | mono | `> seri`                                             |
| Row    | mono | `Verify command: bun run check (config)`             |
| Label  | mono | `Enter/a set · r/Delete unset · Esc close`           |
| Body   | sans | prose sized for reading, not scanning                |

## Components — what ports directly

Four surfaces from the current TUI, restyled against the pair above. Square corners throughout —
the one deliberate departure from what Ink draws today (`borderStyle="round"`): a hairline box
reads as structure, not a friendly rounded card, and it's the smaller edit in `theme.ts`'s
neighborhood — `borderStyle="single"` in place of `"round"`, everywhere.

**Input box + mode indicator** (`panels/InputBox.tsx`), raw capture:

```
┌──────────────────────────────────────────────┐
│ fix the ConfigPanel wrap                      │
└──────────────────────────────────────────────┘
[approve-each]                    ⏎ send · Ctrl-D quit
```

**Transcript viewport, scrolled up** (`App.tsx`):

```
Session f4bff75d created.
> fix the ConfigPanel wrap
→ read_file(apps/cli/src/tui/commands.ts)
                                    ↑ scrolled — End to follow
```

**Approval prompt — no hue, so weight and a mark carry it** (`panels/ApprovalBox.tsx`):

```
! Approve write_file({"path":"a.txt"})? [y]es / [a]lways (saved for this project) / [N]o
```

**/config — selection is reverse video, not color** (`panels/ConfigPanel.tsx`):

```
> Automatic verification: on                      (reverse video)
  Verify command: bun run check (config)
  Shell command run to verify edits, e.g. "bun run check". Unset disables it.
  ↑/↓ move · Enter/a set · r/Delete unset · Esc/Ctrl-D close
```

## Porting notes — what actually changes in theme.ts

The only file this design touches at the code level. Error and warning lose their hue and gain a
mark instead — the same substitution the approval box above already makes. Accent disappears
outright: nothing in this system needs a fifth color, because selection is a background swap, not
a tint.

```diff
 export const theme = {
-  error: "red",
-  warning: "yellow",
-  accent: "cyan",
+  error: "white",    // bold, "✕ " prefix
+  warning: "white",  // bold, "! " prefix
+  selected: "black", // background, on inverse
   muted: "gray",
 } as const;
```

One asymmetry worth stating plainly: this doc's own web preview owns its background; the TUI does
not. "Paper" above is shorthand for whatever background the person's own terminal already has —
the palette governs foreground text and borders, and the one place a background gets set on
purpose is the reverse-video row, via Ink's `backgroundColor` prop.

## Provenance

Design plan sketched with the `artifact-design` skill, published as an HTML artifact for visual
review, then reduced to this doc. Square-corner direction and this markdown copy: user directive,
2026-08-16.
