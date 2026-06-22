import type { ChatHunk, ChatResult, ChatStatus, ChatTurnView } from './types';

export interface ChatPanelHandlers {
  // payload 예산(2KB)을 넘으면 false를 반환한다. false면 실패 카드를 추가해
  // 사용자에게 원인을 알리고 입력값은 유지한다.
  onSend: (id: string, text: string) => boolean;
  onRevert: (id: string) => void;
}

const STATUS_LABEL: Record<ChatStatus, string> = {
  applied: '적용됨',
  noChange: '변경 없음',
  reverted: '되돌림',
  failed: '실패',
};

// chatResult가 유실되어도 pending 카드가 영원히 멈추지 않게 하는 안전망.
// host의 sentinelTimeoutMs(기본 600초)보다 길게 두어, 정상적으로 진행 중인
// 턴이 조기에 실패로 표시되지 않게 한다 (코멘트 탭의 SUBMIT_SAFETY_RESTORE_MS와 대칭).
const PENDING_TIMEOUT_MS = 660_000;

export class ChatPanel {
  private turns: ChatTurnView[] = [];
  private busy = false;
  private readonly pendingTimers = new Map<string, number>();

  constructor(
    private readonly logRoot: HTMLElement,
    private readonly input: HTMLTextAreaElement,
    private readonly sendBtn: HTMLButtonElement,
    private readonly handlers: ChatPanelHandlers,
  ) {
    this.sendBtn.addEventListener('click', () => this.send());
    // Cmd/Ctrl+Enter로도 전송한다 (멀티라인 입력 중 Enter는 줄바꿈 유지).
    this.input.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.send();
      }
    });
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.sendBtn.disabled = busy;
    this.sendBtn.textContent = busy ? '처리 중...' : '보내기';
    this.input.disabled = busy;
  }

  applyResult(result: ChatResult): void {
    const timer = this.pendingTimers.get(result.id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.pendingTimers.delete(result.id);
    }
    const turn = this.turns.find((t) => t.id === result.id);
    if (!turn) {
      // 알 수 없는 id (예: busy 거부 응답) — 새 카드로 추가해 사용자가
      // 원인을 볼 수 있게 한다.
      this.turns.push({
        id: result.id,
        instruction: '(요청)',
        pending: false,
        status: result.status,
        summary: result.summary || result.error || '',
        hunks: result.hunks,
        error: result.error,
      });
      this.render();
      return;
    }
    turn.pending = false;
    turn.status = result.status;
    turn.summary = result.summary;
    turn.hunks = result.hunks;
    turn.error = result.error;
    this.render();
  }

  private send(): void {
    if (this.busy) {
      return;
    }
    const text = this.input.value.trim();
    if (text.length === 0) {
      return;
    }
    const id = this.newId();
    const accepted = this.handlers.onSend(id, text);
    if (!accepted) {
      this.turns.push({
        id,
        instruction: text,
        pending: false,
        status: 'failed',
        summary: '입력이 너무 깁니다 (2KB 제한). 줄여서 다시 보내세요.',
      });
      this.render();
      return;
    }
    this.turns.push({ id, instruction: text, pending: true });
    this.input.value = '';
    this.armPendingTimer(id);
    this.render();
  }

  private armPendingTimer(id: string): void {
    const timer = window.setTimeout(() => {
      this.pendingTimers.delete(id);
      const t = this.turns.find((x) => x.id === id);
      if (t && t.pending) {
        t.pending = false;
        t.status = 'failed';
        t.summary = '응답을 받지 못했습니다. 다시 시도해 주세요.';
        this.render();
      }
    }, PENDING_TIMEOUT_MS);
    this.pendingTimers.set(id, timer);
  }

  private newId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `t-${this.turns.length}-${this.logRoot.childElementCount}`;
    }
  }

  private render(): void {
    this.logRoot.innerHTML = '';
    for (const t of this.turns) {
      this.logRoot.appendChild(this.renderTurn(t));
    }
    // 최신 카드가 보이도록 맨 아래로 스크롤한다.
    this.logRoot.scrollTop = this.logRoot.scrollHeight;
  }

  private renderTurn(t: ChatTurnView): HTMLElement {
    const card = document.createElement('div');
    card.className = 'chat-turn';
    card.setAttribute('data-turn-id', t.id);

    const instr = document.createElement('div');
    instr.className = 'chat-instruction';
    instr.textContent = t.instruction;
    card.appendChild(instr);

    if (t.pending) {
      const pend = document.createElement('div');
      pend.className = 'chat-status pending';
      pend.textContent = 'LLM이 작업 중입니다...';
      card.appendChild(pend);
      return card;
    }

    const status = document.createElement('div');
    status.className = `chat-status ${t.status ?? ''}`;
    const label = t.status ? STATUS_LABEL[t.status] : '';
    status.textContent = t.summary ? `${label} · ${t.summary}` : label;
    card.appendChild(status);

    if (t.hunks && t.hunks.length > 0) {
      card.appendChild(this.renderDiff(t.hunks));
    }

    if (t.status === 'applied') {
      const revert = document.createElement('button');
      revert.type = 'button';
      revert.className = 'chat-revert';
      revert.textContent = '되돌리기';
      revert.addEventListener('click', () => this.handlers.onRevert(t.id));
      card.appendChild(revert);
    }
    return card;
  }

  private renderDiff(hunks: readonly ChatHunk[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'chat-diff';
    for (const h of hunks) {
      const block = document.createElement('div');
      block.className = 'chat-hunk';

      const loc = document.createElement('div');
      loc.className = 'hunk-loc';
      loc.textContent = `L${h.startLine + 1}`;
      block.appendChild(loc);

      if (h.beforeText.length > 0) {
        const before = document.createElement('pre');
        before.className = 'hunk-before';
        before.textContent = h.beforeText;
        block.appendChild(before);
      }
      if (h.afterText.length > 0) {
        const after = document.createElement('pre');
        after.className = 'hunk-after';
        after.textContent = h.afterText;
        block.appendChild(after);
      }
      wrap.appendChild(block);
    }
    return wrap;
  }
}
