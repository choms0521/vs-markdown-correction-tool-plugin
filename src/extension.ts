import * as vscode from 'vscode';
import { release } from 'os';
import { MarkdownReviewEditor } from './editor/MarkdownReviewEditor';

const WIN10_1809_BUILD = 17763;

export function activate(context: vscode.ExtensionContext): void {
  const lifecycle = vscode.window.createOutputChannel('mdReview-lifecycle');
  const version =
    (context.extension.packageJSON?.version as string | undefined) ?? 'unknown';
  lifecycle.appendLine(
    `[mdReview] activate version=${version} vscode=${vscode.version} ` +
      `node=${process.version} platform=${process.platform} arch=${process.arch}`,
  );

  if (process.platform === 'win32') {
    const rel = release();
    const buildStr = rel.split('.')[2] ?? '0';
    const build = Number.parseInt(buildStr, 10);
    if (Number.isFinite(build) && build < WIN10_1809_BUILD) {
      lifecycle.appendLine(
        `[mdReview] os-guard-violation win32 build=${build} (1809+ required for ConPTY)`,
      );
      void vscode.window.showWarningMessage(
        'mdReview는 Windows 10 1809(build 17763) 이상이 필요합니다. 현재 빌드에서는 PTY 호출이 실패할 수 있습니다.',
      );
    }
  }

  const provider = new MarkdownReviewEditor(context);
  context.subscriptions.push(
    lifecycle,
    vscode.window.registerCustomEditorProvider(
      MarkdownReviewEditor.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.commands.registerCommand('mdReview.submit', () => {
      void vscode.window.showInformationMessage(
        'mdReview: 명령 팔레트가 아닌 에디터 측면 패널의 [제출] 버튼을 사용해주십시오.',
      );
    }),
    vscode.commands.registerCommand('mdReview.toggle', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (!tab) {
        lifecycle.appendLine('[mdReview] toggle: no active tab');
        return;
      }
      const input = tab.input;
      let uri: vscode.Uri | undefined;
      let isReview = false;
      if (input instanceof vscode.TabInputText) {
        uri = input.uri;
      } else if (input instanceof vscode.TabInputCustom) {
        uri = input.uri;
        isReview = input.viewType === MarkdownReviewEditor.viewType;
      }
      if (!uri || !uri.path.toLowerCase().endsWith('.md')) {
        lifecycle.appendLine(
          `[mdReview] toggle: not a markdown tab uri=${uri?.toString() ?? 'none'}`,
        );
        return;
      }
      const target = isReview ? 'default' : MarkdownReviewEditor.viewType;
      lifecycle.appendLine(
        `[mdReview] toggle uri=${uri.toString()} target=${target}`,
      );
      await vscode.commands.executeCommand('vscode.openWith', uri, target);
    }),
  );
}

export function deactivate(): void {
  // subscriptions이 자동 dispose. NodePtySession은 webviewPanel.onDidDispose에서 graceful kill.
}
