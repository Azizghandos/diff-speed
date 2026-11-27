// A fast drop-in for makefun-diff 1.0.0.
//
// run(input) returns make.fun's own patch of { old, new } as one JSON string:
// the exact patch makefun-diff 1.0.0 returns for the same input. Lines are cut
// after every "\n" only (a "\r" stays part of its line); a last line without
// "\n" is a line too. The edit script keeps the common prefix, then the common
// suffix of what is left; between them it is Myers's greedy search from the
// first lines, keeping on each diagonal the path furthest into the old text
// and, when a deletion and an insertion reach the same point, the deletion's
// path. The patch lists each run of changes with its deletions before its
// insertions and up to 3 kept lines before and after it; runs at most 6 kept
// lines apart share a hunk. A line ending its text without a newline is
// written with one and followed by a "%" line. Identical texts are the header
// alone.
//
// Speed comes from three choices. Lines are interned to small integers once,
// so the search compares integers instead of re-reading strings. The search
// keeps its frontier in typed arrays and never builds a path object per step:
// it stores one integer per diagonal per depth and rebuilds the script by
// walking those integers back, re-applying the same choice rule. The patch is
// assembled straight from the rebuilt runs. Nothing is allocated in the hot
// loop, and the whole run is deterministic.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** The patch's first word, shared by every answer. */
export { FORMAT };

/**
 * A line of a text, as the patch writes it: its op, the line, and, when the
 * line had no newline of its own, one plus a "%" line of its own.
 */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/**
 * The line ids of a text, with the text's split parts kept beside them so a
 * line's text can be read back for the patch. A middle line (one that ends in
 * "\n") is interned by its text before the newline, which identifies it: every
 * middle line ends in "\n", so two of them are equal exactly when those parts
 * are. The last line, when the text does not end in a newline, gets a fresh
 * id of its own, shared with the other text's last line when their parts
 * match, so it can never be confused with a middle line.
 */
function lineIds(text, shared) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const hasBare = parts[last] !== '';
  const count = last + (hasBare ? 1 : 0);
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    let id = shared.map.get(parts[i]);
    if (id === undefined) {
      id = shared.next;
      shared.map.set(parts[i], id);
      shared.next++;
    }
    ids[i] = id;
  }
  return { ids, parts, count, barePart: hasBare ? parts[last] : null };
}

/** The text of one line of a split text, newline included when it had one. */
function lineText(parts, i) {
  return i < parts.length - 1 ? parts[i] + '\n' : parts[parts.length - 1];
}

/**
 * Myers's greedy search on the middle lines, returning the edit runs of the
 * middle in order. `a` and `b` hold line ids; equal ids are equal lines.
 * The frontier is one integer per diagonal per depth, stored as the count of
 * old lines consumed plus one (zero marks a diagonal no path reached), so no
 * path object is ever built; the script is rebuilt by walking back through
 * those integers and re-applying the choice rule at each step.
 */
function myersRuns(a, b) {
  const oldLen = a.length;
  const newLen = b.length;
  // One frontier array per depth; vs[d][j] is the diagonal k = j - d.
  const vs = [];
  let x = 0;
  let y = 0;
  while (x < oldLen && y < newLen && a[x] === b[y]) {
    x++;
    y++;
  }
  const v0 = new Int32Array(1);
  v0[0] = x + 1;
  vs.push(v0);
  let depth = 0;
  let finalK = 0;
  if (x !== oldLen || y !== newLen) {
    let done = false;
    for (let d = 1; d <= oldLen + newLen && !done; d++) {
      const prev = vs[d - 1];
      const cur = new Int32Array(2 * d + 1);
      // The two diagonals a step here can come from are read once each and
      // carried along: the insertion source of this diagonal is the deletion
      // source of the next one, two diagonals on, so each entry of the
      // previous frontier is read exactly once.
      let insVal = prev[0];
      let delVal = 0;
      for (let j = 0; j <= 2 * d; j += 2) {
        const k = j - d;
        const fromDel = delVal;
        const fromIns = insVal;
        // Where each candidate lands in the old text; -1 when it cannot move.
        const candDel = fromDel > 0 && fromDel <= oldLen ? fromDel : -1;
        const candIns = fromIns > 0 && fromIns - 1 - k <= newLen ? fromIns - 1 : -1;
        const start = candDel >= candIns ? candDel : candIns;
        if (start >= 0) {
          let px = start;
          let py = px - k;
          while (px < oldLen && py < newLen && a[px] === b[py]) {
            px++;
            py++;
          }
          cur[j] = px + 1;
          if (px === oldLen && py === newLen) {
            depth = d;
            finalK = k;
            done = true;
            break;
          }
        }
        // An unreachable diagonal stays zero: a fresh typed array is all zeroes.
        delVal = insVal;
        insVal = j + 2 <= 2 * d - 2 ? prev[j + 2] : 0;
      }
      vs.push(cur);
    }
  }

  // Walk the script back from (depth, finalK). Runs are collected in reverse
  // and merged as they go, then flipped into order at the end.
  const rev = [];
  const pushRev = (kind, count) => {
    if (count <= 0) return;
    const last = rev[rev.length - 1];
    if (last !== undefined && last.kind === kind) last.count += count;
    else rev.push({ kind, count });
  };
  let d = depth;
  let k = finalK;
  let cx = vs[d][k + d] - 1;
  while (true) {
    if (d === 0) {
      pushRev(KEEP, cx);
      break;
    }
    const prev = vs[d - 1];
    const fromDel = k > -d ? prev[k + d - 2] : 0;
    const fromIns = k < d ? prev[k + d] : 0;
    const byDel = fromDel > 0 ? fromDel : -1;
    const byIns = fromIns > 0 ? fromIns - 1 : -1;
    const okDel = byDel >= 0 && byDel <= oldLen;
    const okIns = byIns >= 0 && byIns - k <= newLen;
    const reachDel = okDel ? byDel : -1;
    const reachIns = okIns ? byIns : -1;
    if (reachDel < 0 && reachIns < 0) throw new Error('diff: no path back');
    // The step into this point, by the same rule as the search: the deletion
    // when it reaches at least as far into the old text as the insertion.
    let stepX;
    let deleted;
    if (reachDel >= reachIns) {
      stepX = reachDel;
      deleted = true;
    } else {
      stepX = reachIns;
      deleted = false;
    }
    // The snake this point's search followed, from the step to here.
    pushRev(KEEP, cx - stepX);
    if (deleted) {
      pushRev(DELETE, 1);
      cx = fromDel - 1;
      k = k - 1;
    } else {
      pushRev(INSERT, 1);
      cx = fromIns - 1;
      k = k + 1;
    }
    d = d - 1;
  }
  rev.reverse();
  return rev;
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff: the input is { old, new }, two strings');
  }
  const shared = { map: new Map(), next: 0 };
  const old = lineIds(input.old, shared);
  const neu = lineIds(input.new, shared);
  // The bare last lines, if any, get ids past every interned one.
  let bareId = shared.next;
  let oldBare = -1;
  let newBare = -1;
  if (old.barePart !== null) {
    oldBare = bareId;
    bareId++;
  }
  if (neu.barePart !== null) {
    if (old.barePart !== null && old.barePart === neu.barePart) newBare = oldBare;
    else {
      newBare = bareId;
      bareId++;
    }
  }
  if (oldBare >= 0) old.ids[old.count - 1] = oldBare;
  if (newBare >= 0) neu.ids[neu.count - 1] = newBare;

  const a = old.ids;
  const b = neu.ids;
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...myersRuns(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', lineText(old.parts, at)));
      for (let i = 0; i < c.dels; i++) out.push(written('-', lineText(old.parts, c.o + i)));
      for (let i = 0; i < c.ins; i++) out.push(written('+', lineText(neu.parts, c.p + i)));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', lineText(old.parts, at)));
  }
  return out.join('');
}
