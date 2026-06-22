import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { randomBytes } from 'crypto';
import { WebViewBridge } from './WebViewBridge';
import { CommentSession } from './CommentSession';
import { createPersistenceBackend } from '../store/PersistenceBackendFactory';
import { CommentStore } from '../store/CommentStore';
import { LLMOrchestrator, type OrchestratorConfig } from '../llm/LLMOrchestrator';
import { ChatSession } from '../llm/ChatSession';
import { NodePtySession } from '../pty/NodePtySession';
import {
  ProviderNameSchema,
  ALLOWED_COMMAND_BASENAMES,
  type ProviderName,
} from '../llm/ProviderConfig';
import {
  PreviewThemeSchema,
  WebViewToHostMessageSchema,
  type ChatHunk,
  type ChatStatus,
} from './messages';
import { attachDataLineAttrs } from './markdownLineMap';
import { HunkComputer } from '../diff/HunkComputer';
import { type Hunk } from '../diff/types';
import { DiffPresenter } from '../diff/DiffPresenter';
import { HunkApprover } from '../diff/HunkApprover';
import { WorkspaceEditBuilder } from '../diff/WorkspaceEditBuilder';
import { DiffApplyFlow } from '../diff/DiffApplyFlow';
import {
  makeDiffPresenterDeps,
  makeEditApplier,
  makeQuickPickBridge,
} from '../diff/VSCodeBridges';

// 채팅 턴별 되돌리기 snapshot 보관 상한. 큰 문서에서 턴이 무한 누적될 때
// 메모리가 턴 수에 비례해 증가하는 것을 막는다 (오래된 턴부터 제거).
const MAX_REVERT_SNAPSHOTS = 20;

export class MarkdownReviewEditor implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'mdReview.editor';

  private readonly md: MarkdownIt;
  private readonly output: vscode.OutputChannel;
  // 살아있는 멀티턴 채팅 세션들. 각 에디터 탭이 onDidDispose에서 자기
  // 세션을 정리하지만, 확장 비활성화(deactivate) 시 일괄 정리용 안전망으로
  // provider가 핸들을 보유한다.
  private readonly sessions = new Set<ChatSession>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.md = new MarkdownIt({ html: false, linkify: true });
    attachDataLineAttrs(this.md);
    this.output = vscode.window.createOutputChannel('mdReview');
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.output.appendLine(`[mdReview] resolve:start uri=${document.uri.toString()}`);
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };
    webviewPanel.webview.html = this.renderShell(webviewPanel.webview);

    const bridge = new WebViewBridge(webviewPanel.webview, this.output);

    const config = vscode.workspace.getConfiguration('mdReview');
    const backendKind = config.get<string>('persistenceBackend', 'sidecar');
    const backend = createPersistenceBackend(backendKind, {
      memento: this.context.workspaceState,
    });
    const store = new CommentStore(backend);
    const session = new CommentSession(document, store, bridge);

    const orchestrator = this.makeOrchestrator();
    const flow = this.makeDiffApplyFlow();
    // 멀티턴 채팅 세션. 여기서는 생성만 하고 PTY spawn은 첫 전송(runTurn)
    // 때까지 미룬다 — 문서를 열어두기만 한 탭은 claude 프로세스를 점유하지
    // 않는다.
    const chatSession = this.makeChatSession();
    this.sessions.add(chatSession);
    // 두 탭(코멘트 제출 / 작업 요청)이 같은 문서를 수정하므로, 한 번에
    // 하나의 LLM 작업만 허용한다. busyUpdate로 양쪽 버튼을 함께 잠근다.
    let inFlight = false;
    // 채팅 턴별 수정 전 본문 (되돌리기용). snapshot은 2KB를 넘을 수 있어
    // webview가 아닌 호스트가 보관한다.
    const turnSnapshots = new Map<string, string>();

    session.attachSubmitHandler(async (comments) => {
      if (inFlight) {
        await vscode.window.showWarningMessage(
          'mdReview: 다른 작업이 진행 중입니다. 잠시 후 다시 시도하십시오.',
        );
        return;
      }
      inFlight = true;
      void bridge.post({ type: 'busyUpdate', busy: true });
      const cfg = vscode.workspace.getConfiguration('mdReview');
      const applyMode = cfg.get<'direct' | 'diff'>('applyMode', 'direct');
      const snapshot = document.getText();
      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'mdReview: LLM 응답을 기다리는 중입니다... (최대 10분)',
          },
          () =>
            orchestrator.submit(snapshot, comments, {
              mode: applyMode,
              filePath: document.uri.fsPath,
            }),
        );
        this.output.appendLine(
          `[mdReview] submit ok mode=${applyMode} uuid=${result.uuid} bytes=${result.markdown.length}`,
        );
        if (applyMode === 'direct') {
          void this.notifyDirectApplied(document, snapshot);
          return;
        }
        const fileName = document.uri.path.split('/').pop() ?? 'review.md';
        await flow.run({
          documentUri: document.uri,
          documentText: document.getText(),
          revisedMarkdown: result.markdown,
          fileName,
          autoApply: cfg.get<boolean>('autoApply', false),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // direct 모드에서 완료 신호(sentinel)를 놓쳐 timeout이 났더라도
        // 파일이 실제로 수정됐다면 성공으로 간주한다.
        if (applyMode === 'direct' && document.getText() !== snapshot) {
          this.output.appendLine(
            '[mdReview] direct: sentinel 미검출이나 파일 변경 감지 — 적용 처리',
          );
          void this.notifyDirectApplied(document, snapshot);
          return;
        }
        await vscode.window.showErrorMessage(`mdReview submit 실패: ${msg}`);
      } finally {
        inFlight = false;
        void bridge.post({ type: 'busyUpdate', busy: false });
      }
    });

    // 테마 메시지는 설정 접근이 필요하므로 CommentSession이 아닌 여기서
    // 직접 처리한다 (코멘트 lifecycle과 무관한 뷰 설정).
    const themeSub = webviewPanel.webview.onDidReceiveMessage(async (raw) => {
      const parsed = WebViewToHostMessageSchema.safeParse(raw);
      if (!parsed.success) {
        return;
      }
      if (parsed.data.type === 'setTheme') {
        await vscode.workspace
          .getConfiguration('mdReview')
          .update('previewTheme', parsed.data.theme, vscode.ConfigurationTarget.Global);
        this.output.appendLine(`[mdReview] previewTheme=${parsed.data.theme}`);
        return;
      }
      if (parsed.data.type === 'ready') {
        const theme = PreviewThemeSchema.catch('auto').parse(
          vscode.workspace.getConfiguration('mdReview').get('previewTheme', 'auto'),
        );
        void bridge.post({ type: 'themeUpdate', theme });
        return;
      }
      if (parsed.data.type === 'chatRequest') {
        if (inFlight) {
          void bridge.post({
            type: 'chatResult',
            id: parsed.data.id,
            status: 'failed',
            summary: '다른 작업이 진행 중입니다.',
            hunks: [],
            error: '다른 작업이 진행 중입니다.',
          });
          return;
        }
        inFlight = true;
        void bridge.post({ type: 'busyUpdate', busy: true });
        try {
          await this.runChatInstruction(
            document,
            session,
            chatSession,
            bridge,
            parsed.data.id,
            parsed.data.text,
            turnSnapshots,
          );
        } finally {
          inFlight = false;
          void bridge.post({ type: 'busyUpdate', busy: false });
        }
        return;
      }
      if (parsed.data.type === 'chatRevert') {
        if (inFlight) {
          return;
        }
        inFlight = true;
        void bridge.post({ type: 'busyUpdate', busy: true });
        try {
          await this.revertChatTurn(
            document,
            bridge,
            parsed.data.id,
            turnSnapshots,
          );
        } finally {
          inFlight = false;
          void bridge.post({ type: 'busyUpdate', busy: false });
        }
        return;
      }
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      session.updateBody(this.renderBody(document), document.getText());
    });

    webviewPanel.onDidDispose(() => {
      themeSub.dispose();
      changeSub.dispose();
      // 탭이 닫히는 모든 경로(×, 창 닫기, 그룹 닫기, Reload Window)에서
      // PTY 세션을 확실히 종료한다 (진행 중 턴은 abort로 끊김).
      // VSCode는 dispose 핸들러의 반환 Promise를 기다리지 않으므로, dispose
      // 실패가 unhandled rejection으로 남지 않게 명시적으로 삼켜 로그만 남긴다.
      this.sessions.delete(chatSession);
      void Promise.all([session.dispose(), chatSession.dispose()]).catch(
        (err) => {
          this.output.appendLine(
            `[mdReview] dispose 실패: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        },
      );
    });

    await session.start(this.renderBody(document), document.getText());
    this.output.appendLine('[mdReview] resolve:done');
  }

  private async notifyDirectApplied(
    document: vscode.TextDocument,
    snapshot: string,
  ): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      'mdReview: LLM이 본문을 직접 수정하였습니다. 내용을 확인하십시오.',
      '되돌리기',
    );
    if (choice !== '되돌리기') {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    edit.replace(document.uri, fullRange, snapshot);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    this.output.appendLine('[mdReview] direct: 사용자 요청으로 수정 전 본문 복원');
  }

  // 작업 요청(채팅) 탭: 자유 지시 1개로 CLI가 파일을 직접 수정하게 하고,
  // 결과 diff를 우리가 직접 산출한다 (TUI 화면 긁기에 의존하지 않음).
  // 어떤 예외(파일 IO 실패, 대형 문서 diff 계산 실패 등)가 나더라도 반드시
  // chatResult로 끝맺어, pending 카드가 영원히 멈추는 것을 막는다.
  private async runChatInstruction(
    document: vscode.TextDocument,
    session: CommentSession,
    chatSession: ChatSession,
    bridge: WebViewBridge,
    id: string,
    text: string,
    turnSnapshots: Map<string, string>,
  ): Promise<void> {
    try {
      // CLI는 디스크 파일을 수정하므로 미저장 버퍼 변경을 먼저 반영한다.
      if (document.isDirty) {
        await document.save();
      }
      // before/after 모두 디스크에서 읽는다. 이전 턴에서 claude가 디스크를
      // 고친 뒤 VSCode 버퍼 reload가 비동기로 늦으면, 버퍼는 이전 턴 이전
      // 상태라 diff에 이전 턴 변경까지 섞인다 (멀티턴 오염). 디스크가
      // direct 모드의 유일한 진실이다.
      const before = await this.readDiskText(document.uri);
      let after = before;
      let submitError: string | undefined;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'mdReview: 작업 요청을 처리하는 중입니다... (최대 10분)',
          },
          () =>
            chatSession.runTurn(
              document.uri.fsPath,
              text,
              session.getComments(),
            ),
        );
        after = await this.readDiskText(document.uri);
      } catch (e) {
        // 완료 신호를 놓쳐 timeout이 났더라도 파일이 실제로 바뀌었으면
        // 성공으로 간주한다. 세션 종료(abort)로 인한 예외도 여기로 온다.
        after = await this.readDiskSafe(document.uri, before);
        if (after === before) {
          submitError = e instanceof Error ? e.message : String(e);
        }
      }

      const changed = after !== before;
      let hunks: Hunk[] = [];
      let diffTruncated = false;
      if (changed) {
        try {
          hunks = new HunkComputer().compute(before, after);
        } catch {
          // 대형 문서 등으로 diff 산출이 실패해도 변경 자체는 적용된 것이다.
          diffTruncated = true;
        }
      }

      let status: ChatStatus;
      if (changed) {
        status = 'applied';
        turnSnapshots.set(id, before);
        // 가장 오래된 snapshot부터 제거해 보관량을 상한으로 묶는다
        // (오래된 턴은 되돌리기 불가, 이미 알려진 제약과 일관).
        while (turnSnapshots.size > MAX_REVERT_SNAPSHOTS) {
          const oldest = turnSnapshots.keys().next().value;
          if (oldest === undefined) {
            break;
          }
          turnSnapshots.delete(oldest);
        }
      } else if (submitError) {
        status = 'failed';
      } else {
        status = 'noChange';
      }

      this.output.appendLine(
        `[mdReview] chat id=${id} status=${status} hunks=${hunks.length}` +
          (diffTruncated ? ' (diff 생략)' : ''),
      );
      void bridge.post({
        type: 'chatResult',
        id,
        status,
        summary: this.summarizeChat(status, hunks, submitError, diffTruncated),
        hunks: hunks.map(toChatHunk),
        error: submitError,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.output.appendLine(`[mdReview] chat id=${id} FAIL: ${msg}`);
      void bridge.post({
        type: 'chatResult',
        id,
        status: 'failed',
        summary: `처리 실패: ${msg}`,
        hunks: [],
        error: msg,
      });
    }
  }

  private async revertChatTurn(
    document: vscode.TextDocument,
    bridge: WebViewBridge,
    id: string,
    turnSnapshots: Map<string, string>,
  ): Promise<void> {
    const snapshot = turnSnapshots.get(id);
    if (snapshot === undefined) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    edit.replace(document.uri, fullRange, snapshot);
    await vscode.workspace.applyEdit(edit);
    await document.save();
    turnSnapshots.delete(id);
    this.output.appendLine(`[mdReview] chat revert id=${id}`);
    void bridge.post({
      type: 'chatResult',
      id,
      status: 'reverted',
      summary: '수정 전 상태로 되돌렸습니다.',
      hunks: [],
    });
  }

  private async readDiskText(uri: vscode.Uri): Promise<string> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(bytes).toString('utf8');
  }

  // catch 경로에서 디스크를 재확인할 때 fs 오류로 또 던지지 않도록 감싼다.
  private async readDiskSafe(
    uri: vscode.Uri,
    fallback: string,
  ): Promise<string> {
    try {
      return await this.readDiskText(uri);
    } catch {
      return fallback;
    }
  }

  private summarizeChat(
    status: ChatStatus,
    hunks: readonly { beforeText: string; afterText: string }[],
    error?: string,
    diffTruncated = false,
  ): string {
    if (status === 'failed') {
      return error ? `처리 실패: ${error}` : '처리에 실패했습니다.';
    }
    if (status === 'noChange') {
      return '완료 — 변경된 내용이 없습니다.';
    }
    if (diffTruncated) {
      return '변경이 적용되었습니다 (문서가 커서 변경 미리보기는 생략).';
    }
    const countLines = (t: string) => (t.length === 0 ? 0 : t.split('\n').length);
    let added = 0;
    let removed = 0;
    for (const h of hunks) {
      added += countLines(h.afterText);
      removed += countLines(h.beforeText);
    }
    return `${hunks.length}개 구간 변경 (+${added} / -${removed}줄)`;
  }

  private renderShell(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'media',
        'webview',
        'dist',
        'main.js',
      ),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'media',
        'webview',
        'style.css',
      ),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} https: data:`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${styleUri}">
<title>Markdown Review</title>
</head>
<body>
<div id="layout">
  <main id="doc-body"></main>
  <aside id="panel">
    <header>
      <div id="tabs" role="tablist">
        <button id="tab-review" class="tab active" type="button" role="tab" aria-selected="true" aria-controls="review-pane">md수정</button>
        <button id="tab-chat" class="tab" type="button" role="tab" aria-selected="false" aria-controls="chat-pane">작업 요청</button>
      </div>
      <button id="theme-toggle" type="button" title="프리뷰 테마 전환">테마: 자동</button>
    </header>
    <section id="review-pane" class="pane active" role="tabpanel" aria-labelledby="tab-review">
      <ul id="comment-list"></ul>
      <button id="submit-btn" type="button">제출</button>
    </section>
    <section id="chat-pane" class="pane" role="tabpanel" aria-labelledby="tab-chat" hidden>
      <div id="chat-log"></div>
      <div id="chat-input-row">
        <textarea id="chat-input" rows="3" placeholder="예: 1번 적용해줘 / 전체 맞춤법을 고쳐줘"></textarea>
        <button id="chat-send" type="button">보내기</button>
      </div>
    </section>
  </aside>
</div>
<div id="overlay-root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private renderBody(document: vscode.TextDocument): string {
    return this.md.render(document.getText());
  }

  private makeDiffApplyFlow(): DiffApplyFlow {
    return new DiffApplyFlow({
      hunkComputer: new HunkComputer(),
      diffPresenter: new DiffPresenter(makeDiffPresenterDeps()),
      hunkApprover: new HunkApprover(makeQuickPickBridge()),
      workspaceEditBuilder: new WorkspaceEditBuilder(makeEditApplier()),
      logger: this.output,
      notifier: {
        info: async (m) => {
          await vscode.window.showInformationMessage(m);
        },
        askRetry: async (m) => {
          const choice = await vscode.window.showWarningMessage(
            m,
            '다시 선택',
            '닫기',
          );
          return choice === '다시 선택';
        },
      },
    });
  }

  private readProviderConfig(): OrchestratorConfig {
    const cfg = vscode.workspace.getConfiguration('mdReview');
    const providerRaw = cfg.get<string>('defaultProvider', 'claude');
    const provider: ProviderName = ProviderNameSchema.parse(providerRaw);
    const providers = cfg.get<
      Record<string, { command?: string; args?: string[] }>
    >('providers', {});
    const pcfg = providers[provider] ?? {};
    // provider명과 실행 명령 basename이 다를 수 있다 (antigravity → agy).
    // command 미설정 시 provider명을 그대로 쓰면 basename 검증에서 거부되므로,
    // provider별 정규 basename으로 폴백한다.
    const command = pcfg.command ?? ALLOWED_COMMAND_BASENAMES[provider];
    const args = pcfg.args ?? [];
    const sentinelTimeoutMs = cfg.get<number>('sentinelTimeoutMs', 600_000);
    return { provider, command, args, sentinelTimeoutMs };
  }

  private makeOrchestrator(): LLMOrchestrator {
    return new LLMOrchestrator({
      output: this.output,
      readConfig: () => this.readProviderConfig(),
      spawn: (command, args) => NodePtySession.spawnDefault(command, [...args]),
    });
  }

  private makeChatSession(): ChatSession {
    return new ChatSession({
      output: this.output,
      readConfig: () => this.readProviderConfig(),
      spawn: (command, args) => NodePtySession.spawnDefault(command, [...args]),
    });
  }

  // 확장 비활성화(deactivate) 시 살아있는 모든 채팅 PTY 세션을 정리한다.
  // 개별 탭은 onDidDispose에서 이미 정리되지만, 이는 그에 대한 안전망이다.
  async disposeAllSessions(): Promise<void> {
    await Promise.all([...this.sessions].map((s) => s.dispose()));
    this.sessions.clear();
  }
}

// HunkComputer의 Hunk를 webview 전송용 경량 ChatHunk로 변환한다.
function toChatHunk(h: Hunk): ChatHunk {
  return {
    kind: h.kind,
    startLine: h.beforeRange.startLine,
    beforeText: h.beforeText,
    afterText: h.afterText,
  };
}

