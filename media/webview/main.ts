import { InlineOverlay } from './inline-overlay';
import { CommentPanel } from './comment-panel';
import { ChatPanel } from './chat-panel';
import type { ChatResult, CommentMirror } from './types';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};

const MAX_PAYLOAD = 2048;

const api = acquireVsCodeApi();
const docBody = document.getElementById('doc-body') as HTMLElement;
const overlayRoot = document.getElementById('overlay-root') as HTMLElement;
const commentList = document.getElementById('comment-list') as HTMLElement;
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
const themeToggle = document.getElementById('theme-toggle') as HTMLButtonElement;
const chatLog = document.getElementById('chat-log') as HTMLElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSend = document.getElementById('chat-send') as HTMLButtonElement;
const tabReview = document.getElementById('tab-review') as HTMLButtonElement;
const tabChat = document.getElementById('tab-chat') as HTMLButtonElement;
const reviewPane = document.getElementById('review-pane') as HTMLElement;
const chatPane = document.getElementById('chat-pane') as HTMLElement;

type PreviewTheme = 'auto' | 'light' | 'dark';
const THEME_CYCLE: PreviewTheme[] = ['auto', 'light', 'dark'];
const THEME_LABEL: Record<PreviewTheme, string> = {
  auto: '자동',
  light: '라이트',
  dark: '다크',
};
let currentTheme: PreviewTheme = 'auto';

function applyTheme(theme: PreviewTheme): void {
  currentTheme = theme;
  if (theme === 'auto') {
    delete document.body.dataset.theme;
  } else {
    document.body.dataset.theme = theme;
  }
  themeToggle.textContent = `테마: ${THEME_LABEL[theme]}`;
}

function postWithBudget(payload: unknown): boolean {
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD) {
    console.warn('[mdReview] payload exceeds 2KB; refusing to send');
    return false;
  }
  api.postMessage(payload);
  return true;
}

// submitAck 유실(확장 호스트 오류 등) 시에도 버튼이 영원히 잠기지 않도록
// 하는 안전망. 정상 흐름에서는 submitAck가 먼저 도착해 타이머를 해제한다.
const SUBMIT_SAFETY_RESTORE_MS = 240_000;
let submitSafetyTimer: number | null = null;

const panel = new CommentPanel(commentList, submitBtn, {
  onSubmit: () => {
    if (postWithBudget({ type: 'submit' })) {
      panel.setSubmitBusy(true);
      submitSafetyTimer = window.setTimeout(() => {
        panel.setSubmitBusy(false);
      }, SUBMIT_SAFETY_RESTORE_MS);
    }
  },
  onItemClick: (id) => scrollToAnchor(id),
  onItemRemove: (id) => postWithBudget({ type: 'removeComment', id }),
});

const chatPanel = new ChatPanel(chatLog, chatInput, chatSend, {
  onSend: (id, text) => postWithBudget({ type: 'chatRequest', id, text }),
  onRevert: (id) => {
    postWithBudget({ type: 'chatRevert', id });
  },
});

function activateTab(tab: 'review' | 'chat'): void {
  const isReview = tab === 'review';
  tabReview.classList.toggle('active', isReview);
  tabChat.classList.toggle('active', !isReview);
  reviewPane.classList.toggle('active', isReview);
  chatPane.classList.toggle('active', !isReview);
}
tabReview.addEventListener('click', () => activateTab('review'));
tabChat.addEventListener('click', () => activateTab('chat'));

let sourceLines: string[] = [];
let comments: CommentMirror[] = [];

new InlineOverlay(
  overlayRoot,
  (selection, kind, input) =>
    postWithBudget({
      type: 'addComment',
      kind,
      anchor: {
        line: selection.startLine,
        endLine: selection.endLine,
        col: selection.startColInLine,
        length: selection.length,
      },
      note: kind === 'question' ? input : undefined,
      // 요청(question)도 선택한 원문을 함께 보내 LLM이 대상 구간을
      // 정확히 특정할 수 있게 한다.
      before: selection.text,
      after: kind === 'suggestion' ? input : undefined,
    }),
  () => sourceLines,
);

themeToggle.addEventListener('click', () => {
  const next =
    THEME_CYCLE[(THEME_CYCLE.indexOf(currentTheme) + 1) % THEME_CYCLE.length];
  applyTheme(next);
  postWithBudget({ type: 'setTheme', theme: next });
});

window.addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as { type: string };
  if (!msg || typeof msg.type !== 'string') return;
  switch (msg.type) {
    case 'renderUpdate': {
      const m = msg as unknown as { html: string; source: string };
      docBody.innerHTML = m.html;
      sourceLines = (m.source ?? '').split('\n');
      break;
    }
    case 'themeUpdate':
      applyTheme((msg as unknown as { theme: PreviewTheme }).theme);
      break;
    case 'commentsUpdate': {
      const list = (msg as unknown as { comments: CommentMirror[] }).comments;
      comments = list;
      panel.setComments(list);
      break;
    }
    case 'submitAck':
      // 성공/실패 안내 toast는 host가 표시한다. 여기서는 버튼만 복구.
      if (submitSafetyTimer !== null) {
        window.clearTimeout(submitSafetyTimer);
        submitSafetyTimer = null;
      }
      panel.setSubmitBusy(false);
      break;
    case 'chatResult':
      chatPanel.applyResult(msg as unknown as ChatResult);
      break;
    case 'busyUpdate': {
      // 두 탭이 같은 문서를 수정하므로 어느 작업 중이든 양쪽을 함께 잠근다.
      const busy = (msg as unknown as { busy: boolean }).busy;
      panel.setSubmitBusy(busy);
      chatPanel.setBusy(busy);
      break;
    }
  }
});

// host의 resolveCustomTextEditor는 webview 로드 전에 반환되므로,
// 초기 상태(renderUpdate/commentsUpdate)는 이 ready 신호를 받은 host가 push한다.
postWithBudget({ type: 'ready' });

// 카드 클릭 시 본문에서 해당 소스 줄 범위와 겹치는 블록들을 강조하고
// 첫 블록으로 스크롤한다.
function scrollToAnchor(commentId: string): void {
  const c = comments.find((x) => x.id === commentId);
  if (!c) return;
  const start = c.anchor.line;
  const end = c.anchor.endLine ?? c.anchor.line + 1;

  const blocks = Array.from(
    docBody.querySelectorAll<HTMLElement>('[data-line]'),
  ).filter((el) => {
    const bStart = Number(el.getAttribute('data-line') ?? '-1');
    const bEnd = Number(el.getAttribute('data-line-end') ?? String(bStart + 1));
    return bStart < end && bEnd > start;
  });
  if (blocks.length === 0) return;

  blocks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  for (const el of blocks) {
    el.classList.add('is-highlighted');
  }
  window.setTimeout(() => {
    for (const el of blocks) {
      el.classList.remove('is-highlighted');
    }
  }, 1800);
}
