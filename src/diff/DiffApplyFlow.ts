import { HunkComputer } from './HunkComputer';
import { DiffPresenter } from './DiffPresenter';
import { HunkApprover } from './HunkApprover';
import { WorkspaceEditBuilder } from './WorkspaceEditBuilder';
import { type UriLike } from './types';

export interface DiffApplyLogger {
  appendLine(line: string): void;
}

export interface DiffApplyNotifier {
  info(message: string): Promise<void>;
  // true를 반환하면 hunk 선택을 다시 시도한다 (Esc 등으로 선택창이 닫혀
  // 응답이 증발하는 것을 방지하는 복구 경로).
  askRetry(message: string): Promise<boolean>;
}

export interface DiffApplyFlowDeps {
  hunkComputer: HunkComputer;
  diffPresenter: DiffPresenter;
  hunkApprover: HunkApprover;
  workspaceEditBuilder: WorkspaceEditBuilder;
  logger: DiffApplyLogger;
  notifier: DiffApplyNotifier;
}

export interface DiffApplyInput {
  documentUri: UriLike;
  documentText: string;
  revisedMarkdown: string;
  fileName: string;
  // true면 hunk 승인 QuickPick을 생략하고 전부 즉시 적용한다.
  autoApply?: boolean;
}

export type DiffApplyOutcome =
  | { kind: 'no-changes' }
  | { kind: 'no-approval' }
  | { kind: 'applied'; appliedCount: number };

export class DiffApplyFlow {
  constructor(private readonly deps: DiffApplyFlowDeps) {}

  async run(input: DiffApplyInput): Promise<DiffApplyOutcome> {
    const hunks = this.deps.hunkComputer.compute(
      input.documentText,
      input.revisedMarkdown,
    );
    this.deps.logger.appendLine(`[mdReview] hunks=${hunks.length}`);
    if (hunks.length === 0) {
      await this.deps.notifier.info('mdReview: 변경 사항이 없습니다.');
      return { kind: 'no-changes' };
    }

    void this.deps.notifier.info(
      `mdReview: LLM 응답 도착 — 변경점 ${hunks.length}개. 적용할 항목을 선택하십시오.`,
    );

    await this.deps.diffPresenter.present(
      input.documentUri,
      input.revisedMarkdown,
      `mdReview: ${input.fileName}`,
    );

    let approved: Set<string>;
    if (input.autoApply) {
      approved = new Set(hunks.map((h) => h.id));
    } else {
      approved = await this.deps.hunkApprover.askApprovals(hunks);
      while (approved.size === 0) {
        const retry = await this.deps.notifier.askRetry(
          'mdReview: 선택된 hunk가 없습니다. 다시 선택하시겠습니까?',
        );
        if (!retry) {
          await this.deps.notifier.info('mdReview: 적용된 hunk가 없습니다.');
          return { kind: 'no-approval' };
        }
        approved = await this.deps.hunkApprover.askApprovals(hunks);
      }
    }

    const { appliedCount } =
      await this.deps.workspaceEditBuilder.buildAndApply(
        input.documentUri,
        hunks,
        approved,
      );
    this.deps.logger.appendLine(`[mdReview] applied=${appliedCount}`);
    await this.deps.notifier.info(
      `mdReview: ${appliedCount}개 hunk를 본문에 반영하였습니다. 저장(Cmd+S)을 잊지 마십시오.`,
    );
    return { kind: 'applied', appliedCount };
  }
}
