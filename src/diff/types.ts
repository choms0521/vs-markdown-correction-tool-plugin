export interface UriLike {
  toString(): string;
}

export interface HunkRange {
  readonly startLine: number;
  readonly endLineExclusive: number;
}

export type HunkKind = 'replace' | 'insert' | 'delete';

export interface Hunk {
  readonly id: string;
  readonly beforeRange: HunkRange;
  readonly beforeText: string;
  readonly afterText: string;
  readonly kind: HunkKind;
}
