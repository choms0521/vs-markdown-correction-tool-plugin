// 드래그 selection을 마크다운 소스 줄 범위로 환산하는 로직.
// 브라우저별 selection 경계 동작이 미묘하여 Playwright 실브라우저 시험
// (test-webview/)의 대상이 되도록 inline-overlay에서 분리해 둔다.

export interface LineRange {
  startLine: number;
  // exclusive
  endLine: number;
}

export function findLineAttrAncestor(node: Node): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === Node.ELEMENT_NODE) {
      const el = cur as HTMLElement;
      if (el.hasAttribute && el.hasAttribute('data-line')) {
        return el;
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

function blockStart(el: HTMLElement, fallback: number): number {
  return Number(el.getAttribute('data-line') ?? String(fallback));
}

function blockEnd(el: HTMLElement, fallback: number): number {
  return Number(el.getAttribute('data-line-end') ?? String(fallback));
}

export function computeLineRange(range: Range): LineRange {
  const startEl = findLineAttrAncestor(range.startContainer);
  const endEl = findLineAttrAncestor(range.endContainer);
  const startLine = startEl ? blockStart(startEl, 0) : 0;

  if (!endEl) {
    return { startLine, endLine: startLine + 1 };
  }

  // 드래그가 블록 경계에서 끝나면 끝점이 "다음 블록의 offset 0"에 놓인다.
  // 그 블록은 실제 선택에 포함되지 않았으므로 제외해야 한다.
  const endsAtBlockBoundary =
    range.endOffset === 0 && endEl !== startEl;

  const endLine = endsAtBlockBoundary
    ? blockStart(endEl, startLine + 1)
    : blockEnd(endEl, startLine + 1);

  return { startLine, endLine: Math.max(startLine + 1, endLine) };
}

// 마크다운 마커(목록 불릿, task 체크박스, 헤딩 #, 인용 > 등)를 제거하여
// 렌더된 텍스트와 비교 가능한 내용만 남긴다.
function stripMarkers(line: string): string {
  return line
    .replace(/^[\s>#*+-]+/u, '')
    .replace(/^\d+\.\s*/u, '')
    .replace(/^\[[ xX]\]\s*/u, '');
}

// 강조/코드 기호는 렌더 시 사라지므로 비교 전에 양쪽에서 제거한다.
function normalize(s: string): string {
  return s.replace(/[`*_~\s]/gu, '');
}

// 블록 단위 줄 범위는 selection 경계/markdown-it map의 특성상 실제 선택보다
// 넓게 잡힐 수 있다 (뒤따르는 빈 줄, 경계에 걸친 다음 블록 등). 꼬리 줄의
// 내용이 렌더된 선택 텍스트에 실제로 존재하는지 검사하여 없으면 잘라낸다.
export function captureSourceRange(
  range: Range,
  sourceLines: readonly string[],
  renderedText: string,
): LineRange {
  const { startLine, endLine } = computeLineRange(range);
  const normRendered = normalize(renderedText);

  const lineIsSelected = (idx: number): boolean | 'blank' => {
    const raw = sourceLines[idx] ?? '';
    if (raw.trim().length === 0) {
      return 'blank';
    }
    const probe = normalize(stripMarkers(raw)).slice(0, 16);
    return probe.length === 0 || normRendered.includes(probe);
  };

  // 꼬리쪽: 실제 선택에 없는 줄과 빈 줄을 잘라낸다.
  let end = Math.min(endLine, sourceLines.length);
  while (end > startLine + 1 && lineIsSelected(end - 1) !== true) {
    end -= 1;
  }

  // 머리쪽도 대칭으로 방어한다. 드래그 시작점이 이전 블록이나 빈 공간에
  // 걸리면 startLine이 실제 선택보다 위로 잡힐 수 있다.
  let start = startLine;
  while (start < end - 1 && lineIsSelected(start) !== true) {
    start += 1;
  }

  return { startLine: start, endLine: Math.max(start + 1, end) };
}
