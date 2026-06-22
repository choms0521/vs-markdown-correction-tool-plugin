import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { randomBytes } from 'crypto';
import { WebViewBridge } from './WebViewBridge';
import { CommentSession } from './CommentSession';
import { createPersistenceBackend } from '../store/PersistenceBackendFactory';
import { CommentStore } from '../store/CommentStore';
import { LLMOrchestrator } from '../llm/LLMOrchestrator';
import { NodePtySession } from '../pty/NodePtySession';
import {
  ProviderNameSchema,
  type ProviderName,
} from '../llm/ProviderConfig';
import { PreviewThemeSchema, WebViewToHostMessageSchema } from './messages';
import { attachDataLineAttrs } from './markdownLineMap';
import { HunkComputer } from '../diff/HunkComputer';
import { DiffPresenter } from '../diff/DiffPresenter';
import { HunkApprover } from '../diff/HunkApprover';
import { WorkspaceEditBuilder } from '../diff/WorkspaceEditBuilder';
import { DiffApplyFlow } from '../diff/DiffApplyFlow';
import {
  makeDiffPresenterDeps,
  makeEditApplier,
  makeQuickPickBridge,
} from '../diff/VSCodeBridges';

export class MarkdownReviewEditor implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'mdReview.editor';

  private readonly md: MarkdownIt;
  private readonly output: vscode.OutputChannel;

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
    session.attachSubmitHandler(async (comments) => {
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
      }
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      session.updateBody(this.renderBody(document), document.getText());
    });

    webviewPanel.onDidDispose(async () => {
      themeSub.dispose();
      changeSub.dispose();
      await session.dispose();
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
      <strong>코멘트</strong>
      <button id="theme-toggle" type="button" title="프리뷰 테마 전환">테마: 자동</button>
    </header>
    <ul id="comment-list"></ul>
    <button id="submit-btn" type="button">제출</button>
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

  private makeOrchestrator(): LLMOrchestrator {
    const output = this.output;
    return new LLMOrchestrator({
      output,
      readConfig: () => {
        const cfg = vscode.workspace.getConfiguration('mdReview');
        const providerRaw = cfg.get<string>('defaultProvider', 'claude');
        const provider: ProviderName = ProviderNameSchema.parse(providerRaw);
        const providers = cfg.get<Record<string, { command?: string; args?: string[] }>>(
          'providers',
          {},
        );
        const pcfg = providers[provider] ?? {};
        const command = pcfg.command ?? provider;
        const args = pcfg.args ?? [];
        const sentinelTimeoutMs = cfg.get<number>('sentinelTimeoutMs', 600_000);
        return { provider, command, args, sentinelTimeoutMs };
      },
      spawn: (command, args) => NodePtySession.spawnDefault(command, [...args]),
    });
  }
}

