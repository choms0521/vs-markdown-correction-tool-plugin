import { type Hunk, type UriLike } from './types';

export { type UriLike };

export interface Replacement {
  readonly startLine: number;
  readonly startCol: number;
  readonly endLine: number;
  readonly endCol: number;
  readonly newText: string;
}

export interface EditApplier {
  apply(uri: UriLike, replacements: readonly Replacement[]): Promise<boolean>;
}

export class WorkspaceEditBuilder {
  constructor(private readonly applier: EditApplier) {}

  async buildAndApply(
    uri: UriLike,
    hunks: readonly Hunk[],
    approvedIds: ReadonlySet<string>,
  ): Promise<{ appliedCount: number }> {
    const approved = hunks.filter((h) => approvedIds.has(h.id));
    if (approved.length === 0) return { appliedCount: 0 };

    const ordered = [...approved].sort((a, b) => b.beforeRange.startLine - a.beforeRange.startLine);

    const replacements: Replacement[] = ordered.map((h) => ({
      startLine: h.beforeRange.startLine,
      startCol: 0,
      endLine: h.beforeRange.endLineExclusive,
      endCol: 0,
      newText: h.afterText.length > 0 ? h.afterText + '\n' : '',
    }));

    const ok = await this.applier.apply(uri, replacements);
    if (!ok) throw new Error('applyEdit가 false를 반환하였습니다');
    return { appliedCount: approved.length };
  }
}
