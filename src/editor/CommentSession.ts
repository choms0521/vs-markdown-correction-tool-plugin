import {
  type Comment,
  type CommentDraft,
} from '../model/Comment';
import { CommentStore } from '../store/CommentStore';
import { WebViewBridge } from './WebViewBridge';
import { type WebViewToHostMessage } from './messages';

export interface SessionDocument {
  uri: { toString(): string };
}

export type SubmitHandler = (comments: readonly Comment[]) => void | Promise<void>;

export interface CommentSessionOptions {
  saveDebounceMs?: number;
}

export class CommentSession {
  private comments: readonly Comment[] = [];
  private bodyHtml = '';
  private bodySource = '';
  private pendingSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSavePromise: Promise<void> | null = null;
  private submitHandler: SubmitHandler | null = null;
  private subscription: { dispose(): void } | null = null;
  private readonly saveDebounceMs: number;

  constructor(
    private readonly document: SessionDocument,
    private readonly store: CommentStore,
    private readonly bridge: WebViewBridge,
    options: CommentSessionOptions = {},
  ) {
    this.saveDebounceMs = options.saveDebounceMs ?? 200;
  }

  attachSubmitHandler(handler: SubmitHandler): void {
    this.submitHandler = handler;
  }

  // 주의: start()는 webview로 어떤 메시지도 보내지 않는다.
  // resolveCustomTextEditor가 반환되기 전에는 webview 콘텐츠가 로드되지
  // 않으므로, 여기서 postMessage 전달을 await하면 host와 webview가 서로를
  // 기다리는 교착이 발생한다. 초기 상태 push는 webview가 보내는 'ready'
  // 메시지를 받은 뒤 수행한다.
  async start(initialBodyHtml: string, initialSource: string): Promise<void> {
    this.bodyHtml = initialBodyHtml;
    this.bodySource = initialSource;
    this.comments = await this.store.load(this.document.uri.toString());
    this.subscription = this.bridge.onMessage((m) => this.handleMessage(m));
  }

  updateBody(html: string, source: string): void {
    this.bodyHtml = html;
    this.bodySource = source;
    void this.bridge.post({ type: 'renderUpdate', html, source });
  }

  getComments(): readonly Comment[] {
    return this.comments;
  }

  private async handleMessage(msg: WebViewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        await this.bridge.post({
          type: 'renderUpdate',
          html: this.bodyHtml,
          source: this.bodySource,
        });
        await this.bridge.post({
          type: 'commentsUpdate',
          comments: [...this.comments],
        });
        return;
      }
      case 'addComment': {
        const draft: CommentDraft = {
          type: msg.kind,
          anchor: msg.anchor,
          note: msg.note,
          before: msg.before,
          after: msg.after,
        };
        this.comments = this.store.add(this.comments, draft);
        this.scheduleSave();
        await this.bridge.post({
          type: 'commentsUpdate',
          comments: [...this.comments],
        });
        return;
      }
      case 'updateComment': {
        this.comments = this.store.update(this.comments, msg.id, msg.patch);
        this.scheduleSave();
        await this.bridge.post({
          type: 'commentsUpdate',
          comments: [...this.comments],
        });
        return;
      }
      case 'removeComment': {
        this.comments = this.store.remove(this.comments, msg.id);
        this.scheduleSave();
        await this.bridge.post({
          type: 'commentsUpdate',
          comments: [...this.comments],
        });
        return;
      }
      case 'submit': {
        if (this.submitHandler) {
          await this.submitHandler(this.comments);
        }
        await this.bridge.post({ type: 'submitAck', placeholder: !this.submitHandler });
        return;
      }
    }
  }

  private scheduleSave(): void {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
    }
    const snapshot = this.comments;
    this.pendingSaveTimer = setTimeout(() => {
      this.pendingSaveTimer = null;
      this.pendingSavePromise = this.store.save(
        this.document.uri.toString(),
        snapshot,
      );
    }, this.saveDebounceMs);
  }

  async flushPendingSave(): Promise<void> {
    if (this.pendingSaveTimer) {
      clearTimeout(this.pendingSaveTimer);
      this.pendingSaveTimer = null;
      await this.store.save(this.document.uri.toString(), this.comments);
      return;
    }
    if (this.pendingSavePromise) {
      await this.pendingSavePromise;
    }
  }

  async dispose(): Promise<void> {
    this.subscription?.dispose();
    this.subscription = null;
    await this.flushPendingSave();
  }
}
