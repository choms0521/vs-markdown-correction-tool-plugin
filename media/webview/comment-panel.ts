import type { CommentMirror } from './types';

// 1-based 표시. endLine은 exclusive로 저장되어 있다.
function formatLineRange(c: CommentMirror): string {
  const start = c.anchor.line + 1;
  const end = c.anchor.endLine ?? c.anchor.line + 1;
  return end > start ? `L${start}-${end}` : `L${start}`;
}

export interface CommentPanelHandlers {
  onSubmit: () => void;
  onItemClick: (commentId: string) => void;
  onItemRemove: (commentId: string) => void;
}

export class CommentPanel {
  private comments: readonly CommentMirror[] = [];

  constructor(
    private readonly listRoot: HTMLElement,
    private readonly submitBtn: HTMLButtonElement,
    private readonly handlers: CommentPanelHandlers,
  ) {
    this.submitBtn.addEventListener('click', () => this.handlers.onSubmit());
  }

  setComments(comments: readonly CommentMirror[]): void {
    this.comments = comments;
    this.render();
  }

  setSubmitBusy(busy: boolean): void {
    this.submitBtn.disabled = busy;
    this.submitBtn.textContent = busy ? 'LLM 응답 대기 중...' : '제출';
  }

  private render(): void {
    this.listRoot.innerHTML = '';
    for (const c of this.comments) {
      const li = document.createElement('li');
      li.setAttribute('data-comment-id', c.id);
      li.addEventListener('click', () => this.handlers.onItemClick(c.id));

      const head = document.createElement('div');
      head.className = 'head';

      const kindWrap = document.createElement('span');
      kindWrap.className = 'kind-wrap';

      const kind = document.createElement('span');
      kind.className = `kind ${c.type}`;
      kind.textContent = c.type === 'suggestion' ? '제안' : '요청';
      kindWrap.appendChild(kind);

      const lines = document.createElement('span');
      lines.className = 'lines';
      lines.textContent = formatLineRange(c);
      lines.title = '클릭하면 본문에서 해당 구간을 표시합니다';
      kindWrap.appendChild(lines);

      head.appendChild(kindWrap);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', '코멘트 삭제');
      remove.title = '삭제';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.onItemRemove(c.id);
      });
      head.appendChild(remove);

      li.appendChild(head);
      this.appendBody(li, c);
      this.listRoot.appendChild(li);
    }
  }

  // 제안은 "원본 → 수정안"을 한 줄로 잇지 않는다. 멀티라인 선택에서는
  // 같은 내용이 두 번 출력된 것처럼 보여 혼란을 준다.
  private appendBody(li: HTMLElement, c: CommentMirror): void {
    if (c.type === 'question') {
      const body = document.createElement('div');
      body.className = 'body';
      body.textContent = c.note ?? '(내용 없음)';
      li.appendChild(body);
      return;
    }

    const before = c.before ?? '';
    const after = c.after ?? '';

    if (before === after || after.length === 0) {
      this.appendBlock(li, '선택 구간 (수정안 동일)', before || '(빈 원본)');
      return;
    }
    this.appendBlock(li, '원본', before || '(빈 원본)');
    this.appendBlock(li, '수정안', after);
  }

  private appendBlock(li: HTMLElement, label: string, text: string): void {
    const labelEl = document.createElement('div');
    labelEl.className = 'body-label';
    labelEl.textContent = label;
    li.appendChild(labelEl);

    const body = document.createElement('div');
    body.className = 'body';
    body.textContent = text;
    li.appendChild(body);
  }
}
