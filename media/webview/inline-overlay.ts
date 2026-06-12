import type { CommentType } from './types';
import { captureSourceRange } from './selection-capture';

export interface OverlaySelection {
  startLine: number;
  // 선택이 끝나는 소스 줄 (exclusive)
  endLine: number;
  startColInLine: number;
  length: number;
  // 원본 마크다운 소스에서 줄 단위로 추출한 텍스트 (제안의 원본으로 사용)
  text: string;
  // 화면에 렌더된 그대로의 선택 텍스트 (복사용)
  renderedText: string;
}

// 입력값이 payload 예산(2KB)을 넘는 등의 사유로 전송이 거부되면 false를
// 반환한다. false면 폼을 닫지 않고 에러를 표시한다.
export type OverlayAddHandler = (
  selection: OverlaySelection,
  type: CommentType,
  input: string,
) => boolean;

const FORM_WIDTH = 480;
const VIEWPORT_MARGIN = 8;

export class InlineOverlay {
  private container: HTMLDivElement | null = null;
  private formOpen = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly onAdd: OverlayAddHandler,
    private readonly getSourceLines: () => string[],
  ) {
    // 드래그만으로 자동 팝업하지 않는다. 선택 후 우클릭이 유일한 진입로.
    document.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
    document.addEventListener('mousedown', (e) => this.handleOutsideClick(e));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });
  }

  // 선택 영역 위에서 우클릭하면 기본 컨텍스트 메뉴 대신 제안/질문/복사
  // 버튼을 커서 위치에 띄운다.
  private handleContextMenu(e: MouseEvent): void {
    if (this.formOpen) {
      return;
    }
    const captured = this.captureSelection();
    if (!captured) {
      return;
    }
    e.preventDefault();
    const cursorRect = new DOMRect(e.clientX, e.clientY, 0, 0);
    this.showButtons(cursorRect, captured.selection);
  }

  // 메뉴 밖을 클릭하면 버튼 메뉴는 닫는다. 폼은 입력 유실 방지를 위해
  // 취소/추가/Escape로만 닫는다.
  private handleOutsideClick(e: MouseEvent): void {
    if (this.formOpen || !this.container) {
      return;
    }
    if (e.target instanceof Node && this.container.contains(e.target)) {
      return;
    }
    this.hide();
  }

  private captureSelection(): { rect: DOMRect; selection: OverlaySelection } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return null;
    }
    const range = sel.getRangeAt(0);
    const docBody = document.getElementById('doc-body');
    if (!docBody || !docBody.contains(range.startContainer)) {
      return null;
    }
    const renderedText = sel.toString();
    if (renderedText.length === 0) {
      return null;
    }
    // 렌더된 화면 텍스트는 마크다운 마커(-, [ ], 백틱 등)가 사라져 원본과
    // 다르다. 제안의 원본은 소스 줄 범위에서 직접 추출한다.
    const sourceLines = this.getSourceLines();
    const { startLine, endLine } = captureSourceRange(
      range,
      sourceLines,
      renderedText,
    );
    const sourceText = sourceLines.slice(startLine, endLine).join('\n');

    return {
      rect: range.getBoundingClientRect(),
      selection: {
        startLine,
        endLine,
        startColInLine: range.startOffset,
        length: renderedText.length,
        text: sourceText.length > 0 ? sourceText : renderedText,
        renderedText,
      },
    };
  }

  // #overlay-root는 position: fixed이므로 viewport 좌표를 그대로 사용한다.
  // 요소가 viewport 밖으로 잘리지 않도록 실제 크기를 측정해 상하좌우를
  // 클램프한다 (el은 이미 DOM에 붙어 있어야 측정 가능).
  private placeAt(el: HTMLElement, rect: DOMRect): void {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = rect.top - h - 6;
    if (top < VIEWPORT_MARGIN) {
      top = rect.bottom + 6;
    }
    top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(top, window.innerHeight - h - VIEWPORT_MARGIN),
    );
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(rect.left, window.innerWidth - w - VIEWPORT_MARGIN),
    );
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
  }

  private resetContainer(className: string): HTMLDivElement {
    if (this.container) {
      this.container.remove();
    }
    this.container = document.createElement('div');
    this.container.className = className;
    this.root.appendChild(this.container);
    return this.container;
  }

  private showButtons(rect: DOMRect, selection: OverlaySelection): void {
    const box = this.resetContainer('overlay-buttons');
    box.appendChild(this.makeAddButton('suggestion', rect, selection));
    box.appendChild(this.makeAddButton('question', rect, selection));
    box.appendChild(this.makeCopyButton(selection.renderedText));
    this.placeAt(box, rect);
  }

  // 우클릭 기본 메뉴를 가로채므로 브라우저의 "복사"를 메뉴 안에 제공한다.
  private makeCopyButton(text: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '복사';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      void navigator.clipboard.writeText(text).catch(() => {
        // clipboard API가 막힌 환경 대비: 선택이 살아있는 동안 execCommand 사용
        document.execCommand('copy');
      });
      this.hide();
    });
    return btn;
  }

  private makeAddButton(
    type: CommentType,
    rect: DOMRect,
    selection: OverlaySelection,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = type === 'suggestion' ? '제안 추가' : '요청 추가';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      this.showForm(type, rect, selection);
    });
    return btn;
  }

  private showForm(
    type: CommentType,
    rect: DOMRect,
    selection: OverlaySelection,
  ): void {
    this.formOpen = true;
    const form = this.resetContainer('overlay-form');
    form.style.width = `${Math.min(FORM_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)}px`;

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent =
      type === 'suggestion' ? '제안 — 수정안 직접 입력' : '요청 — LLM에게 맡길 수정 지시';
    form.appendChild(title);

    const textarea = document.createElement('textarea');
    textarea.rows = 6;
    if (type === 'suggestion') {
      textarea.value = selection.text;
    } else {
      textarea.placeholder = '이 구간을 어떻게 고칠지 요청을 적어주세요 (질문도 가능)';
    }
    form.appendChild(textarea);

    const error = document.createElement('div');
    error.className = 'error';
    form.appendChild(error);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '취소';
    cancel.addEventListener('click', () => this.hide());
    actions.appendChild(cancel);

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary';
    confirm.textContent = '추가';
    confirm.addEventListener('click', () => {
      const input = textarea.value.trim();
      if (input.length === 0) {
        error.textContent = '내용을 입력해 주세요.';
        return;
      }
      const accepted = this.onAdd(selection, type, input);
      if (!accepted) {
        error.textContent =
          '내용이 너무 깁니다 (2KB 제한). 선택 범위나 입력을 줄여 주세요.';
        return;
      }
      this.hide();
    });
    actions.appendChild(confirm);

    form.appendChild(actions);
    this.placeAt(form, rect);
    textarea.focus();
  }

  private hide(): void {
    this.formOpen = false;
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
  }
}
