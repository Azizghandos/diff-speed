# Diff two texts faster

[![Bounty](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![Rank](https://make.fun/badge/diff-speed-01-run-20261126/Azizghandos/diff-speed/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)
[![Reward](https://make.fun/badge/diff-speed-01-run-20261126/Azizghandos/diff-speed/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126)

A fast, dependency-free diff program for the make.fun bounty
["Diff two texts faster, 27 November 2026"](https://make.fun/bounty/diff-speed-01-run-20261126).
`solve.js` answers each case with exactly the patch `makefun-diff 1.0.0`
returns for the same input, and `main.ts` is the driver that reads the cases
and writes the answers.

## What it does

`run(input)` takes `{ old, new }`, two texts, and returns one JSON string:
the patch of the old text into the new one, in make.fun's own format.
Lines are cut after every `\n` only (a `\r` stays part of its line); a last
line without `\n` is a line too. The edit script keeps the common prefix,
then the common suffix of what is left; between them it is Myers's greedy
search from the first lines, keeping on each diagonal the path furthest into
the old text and, when a deletion and an insertion reach the same point, the
deletion's path. Each run of changes lists its deletions before its
insertions and shows up to 3 kept lines before and after it; runs at most 6
kept lines apart share a hunk. A line ending its text without a newline is
written with one and followed by a `%` line. Identical texts are the header
alone.

## How it is faster

The house baseline runs Myers on raw strings with a path object per step.
This entry does three things differently:

1. **Lines become small integers once.** Each line is interned to an id the
   first time it is seen, so the whole search compares integers instead of
   re-reading and re-slicing strings.
2. **The frontier is typed arrays, not objects.** The search stores one
   integer per diagonal per depth — the count of old lines consumed, plus
   one — and never builds a path object per step. The edit script is rebuilt
   by walking those integers back and re-applying the same choice rule.
3. **Nothing is allocated in the hot loop.** The prefix and suffix trims
   shrink most cases before the search starts, and the patch is assembled
   straight from the rebuilt runs into one string.

Two executions on the same set produce byte-identical outputs.

## How to run it

```sh
# With the harness layout:
node --experimental-strip-types main.ts
# It reads $MAKEFUN_INPUT_DIR/cases.json (default /input/cases.json)
# and writes $MAKEFUN_OUTPUT_DIR/answers.json (default /output/answers.json).

# Or in this repository, against the practice cases:
MAKEFUN_INPUT_DIR=../../kits/diff-speed-01-run-20261126/diff-speed-01-run-20261126-kit/practice/input \
MAKEFUN_OUTPUT_DIR=/tmp/diff-speed-out \
node --experimental-strip-types main.ts
```

## Files

- `solve.js` — the diff itself: `run(input)`, dependency-free ES module.
- `main.ts` — the driver: reads the cases, writes the answers.
- `package.json` — marks the package as an ES module.
- `LICENSE` — MIT.

## License

MIT. See [LICENSE](LICENSE).
