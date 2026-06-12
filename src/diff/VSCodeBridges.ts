import * as vscode from 'vscode';
import {
  type QuickPickBridge,
  type QuickPickItemLite,
} from './HunkApprover';
import { type DiffPresenterDeps } from './DiffPresenter';
import { type EditApplier } from './WorkspaceEditBuilder';

type ItemWithId = vscode.QuickPickItem & { _id: string };

export function makeQuickPickBridge(): QuickPickBridge {
  return {
    async showMultiPick(
      items: QuickPickItemLite[],
      options: { title: string; placeHolder: string },
    ) {
      const vscodeItems: ItemWithId[] = items.map((i) => ({
        label: i.label,
        detail: i.detail,
        picked: i.picked,
        _id: i.id,
      }));
      const picked = await vscode.window.showQuickPick<ItemWithId>(
        vscodeItems,
        {
          canPickMany: true,
          title: options.title,
          placeHolder: options.placeHolder,
          // 포커스가 다른 곳으로 가도 선택창이 닫히지 않아야 한다.
          // LLM 응답 대기 중 사용자가 다른 창을 보고 있는 경우가 흔하다.
          ignoreFocusOut: true,
        },
      );
      if (!picked) return undefined;
      const arr = picked as readonly ItemWithId[];
      return arr.map((p) => ({
        id: p._id,
        label: p.label,
        detail: p.detail,
        picked: true,
      }));
    },
  };
}

export function makeDiffPresenterDeps(): DiffPresenterDeps {
  return {
    async openTextDocument(opts) {
      const d = await vscode.workspace.openTextDocument({
        content: opts.content,
        language: opts.language,
      });
      return { uri: d.uri };
    },
    async executeCommand(command, ...args) {
      return Promise.resolve(
        vscode.commands.executeCommand(command, ...args),
      );
    },
  };
}

export function makeEditApplier(): EditApplier {
  return {
    async apply(uri, replacements) {
      const edit = new vscode.WorkspaceEdit();
      const vscodeUri = uri as vscode.Uri;
      for (const r of replacements) {
        const range = new vscode.Range(
          r.startLine,
          r.startCol,
          r.endLine,
          r.endCol,
        );
        edit.replace(vscodeUri, range, r.newText);
      }
      return Promise.resolve(vscode.workspace.applyEdit(edit));
    },
  };
}
