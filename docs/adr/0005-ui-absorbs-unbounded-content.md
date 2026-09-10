# ADR 0005: The UI absorbs unbounded content; it never sizes to it

## Status

Accepted (2026-09)

## Context

Everything the renderer displays comes from outside it: source filenames a
user chose, record counts that can run to seven figures, titles and author
lists from bibliographic metadata, status strings written by the Python
backend. Several surfaces were laid out around the content that happened to
be there when they were built.

The failure this surfaced from: while dedupe runs, the stage card grows a
`100%` label next to "Deduplicating". At the default window size the three
stage cards were already at their content's minimum width, so the extra
label pushed the header out through the side of the card. The same class of
bug sat in the search source card (a long `.bib` filename), the PDF table
(a long status pill squeezing out the "missing on disk" marker), and the
prescreen record card (a long record ID pushing the nav buttons off).

A grid track of `1fr` or a flex row does not protect a child: a flex/grid
item's automatic minimum size is its *content* minimum, so an item pushes
through its track rather than shrinking, and `break-words` does not lower
that minimum (only `break-all` / `anywhere` do).

## Decision

- **Every column, card and row that holds dynamic content declares how it
  gives way** — `min-w-0` plus `truncate` (with a `title` for the full
  value), `break-words`, wrapping (`flex-wrap`), or a scroll container. A
  fixed-size sibling (icon, badge, button) keeps `shrink-0`; the dynamic
  part is what yields.
- **Layout reflows on the size of its own container, not the viewport.**
  The preprocessing pipeline is a `@container`: a left-to-right pipeline
  when it has room, stacked when it does not, and its stage strip goes three
  across only when a card can hold a full stage label. Sidebar width and
  window size then stop being implicit assumptions.
- **Counts are formatted and bounded.** `formatCount` groups digits;
  `countTextSizeClass` steps a headline number's type down as it gains
  digits, so a seven-figure dataset fits the card a three-digit one fits.
  Tests read counts with separators stripped.
- **Tables keep a minimum width and scroll.** Columns that have real minima
  (icons, pills, action buttons) hold them and the wrapper scrolls
  horizontally, rather than the columns squeezing until headers spill.

## Consequences

`findHorizontalOverflow` (`e2e/helpers/test-utils.ts`) reports elements that
stick out sideways of their parent, skipping scroll containers. The
preprocessing e2e asserts it is empty for the pipeline diagram at the
default window size and at a narrow one; extend that assertion to a surface
rather than re-deriving the check.

Truncation is a deliberate outcome, not a fallback: where a value is
truncated it carries a `title` so the full text stays reachable.
