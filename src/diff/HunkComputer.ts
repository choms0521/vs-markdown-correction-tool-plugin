import { type Hunk, type HunkKind } from './types';

interface EditOp {
  readonly kind: 'eq' | 'add' | 'del';
  readonly text: string;
}

export const MAX_DP_CELLS = 4_000_000;

export class HunkComputer {
  compute(original: string, revised: string): Hunk[] {
    const origLines = splitForCompare(original);
    const revLines = splitForCompare(revised);
    const cells = (origLines.length + 1) * (revLines.length + 1);
    if (cells > MAX_DP_CELLS) {
      throw new Error(
        `hunk computation too large: original=${origLines.length} revised=${revLines.length} cells=${cells} max=${MAX_DP_CELLS}`,
      );
    }
    const ops = computeEditScript(origLines, revLines);
    return groupHunks(ops);
  }
}

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function splitForCompare(text: string): string[] {
  const normalized = normalizeEol(text);
  if (normalized === '') return [];
  if (normalized.endsWith('\n')) {
    return normalized.slice(0, -1).split('\n');
  }
  return normalized.split('\n');
}

function computeEditScript(
  origLines: readonly string[],
  revLines: readonly string[],
): EditOp[] {
  const n = origLines.length;
  const m = revLines.length;
  const dp: number[][] = [];
  for (let i = 0; i <= n; i++) {
    dp.push(new Array<number>(m + 1).fill(0));
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (origLines[i - 1] === revLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const ops: EditOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === revLines[j - 1]) {
      ops.push({ kind: 'eq', text: origLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ kind: 'add', text: revLines[j - 1] });
      j--;
    } else {
      ops.push({ kind: 'del', text: origLines[i - 1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

function groupHunks(ops: readonly EditOp[]): Hunk[] {
  const hunks: Hunk[] = [];
  let origLine = 0;
  let i = 0;
  let nextId = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.kind === 'eq') {
      origLine++;
      i++;
      continue;
    }
    const startLine = origLine;
    const dels: string[] = [];
    const adds: string[] = [];
    while (i < ops.length && ops[i].kind !== 'eq') {
      if (ops[i].kind === 'del') {
        dels.push(ops[i].text);
        origLine++;
      } else {
        adds.push(ops[i].text);
      }
      i++;
    }
    const endLineExclusive = startLine + dels.length;
    const kind: HunkKind =
      dels.length === 0 ? 'insert' : adds.length === 0 ? 'delete' : 'replace';
    hunks.push({
      id: `h${nextId}`,
      beforeRange: { startLine, endLineExclusive },
      beforeText: dels.join('\n'),
      afterText: adds.join('\n'),
      kind,
    });
    nextId++;
  }
  return hunks;
}
