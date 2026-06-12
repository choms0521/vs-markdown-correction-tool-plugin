import { type Hunk } from './types';

export interface QuickPickItemLite {
  id: string;
  label: string;
  detail?: string;
  picked?: boolean;
}

export interface QuickPickBridge {
  showMultiPick(
    items: QuickPickItemLite[],
    options: { title: string; placeHolder: string },
  ): Promise<QuickPickItemLite[] | undefined>;
}

export class HunkApprover {
  constructor(private readonly bridge: QuickPickBridge) {}

  async askApprovals(hunks: readonly Hunk[]): Promise<Set<string>> {
    if (hunks.length === 0) return new Set();
    const items: QuickPickItemLite[] = hunks.map((h, idx) => ({
      id: h.id,
      label: formatLabel(h, idx),
      detail: formatPreview(h),
      picked: true,
    }));
    const selected = await this.bridge.showMultiPick(items, {
      title: '적용할 hunk 선택',
      placeHolder:
        'Space로 토글, Enter로 확정, Esc로 전체 취소합니다',
    });
    if (!selected) return new Set();
    return new Set(selected.map((s) => s.id));
  }
}

function formatLabel(h: Hunk, idx: number): string {
  const before = h.beforeRange;
  const beforeCount = before.endLineExclusive - before.startLine;
  const afterCount =
    h.afterText.length === 0 ? 0 : h.afterText.split('\n').length;
  return `H${idx + 1} L${before.startLine + 1}-${before.endLineExclusive} -${beforeCount} +${afterCount}`;
}

const MAX_PREVIEW_LEN = 80;

function formatPreview(h: Hunk): string {
  const before = truncate(h.beforeText, MAX_PREVIEW_LEN);
  const after = truncate(h.afterText, MAX_PREVIEW_LEN);
  return `- ${before} | + ${after}`;
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\n/g, ' / ');
  if (flat.length <= max) return flat;
  return flat.slice(0, max) + '...';
}
