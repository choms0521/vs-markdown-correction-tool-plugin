import { expect } from 'chai';
import {
  DiffApplyFlow,
  type DiffApplyFlowDeps,
} from '../../src/diff/DiffApplyFlow';
import { HunkComputer } from '../../src/diff/HunkComputer';
import { DiffPresenter } from '../../src/diff/DiffPresenter';
import { HunkApprover } from '../../src/diff/HunkApprover';
import { WorkspaceEditBuilder } from '../../src/diff/WorkspaceEditBuilder';
import { type UriLike } from '../../src/diff/types';

interface Capture {
  logs: string[];
  infos: string[];
  presents: { originalUri: UriLike; revised: string; title: string }[];
}

function makeFlow(opts: {
  originalText: string;
  revised: string;
  approveAll?: boolean;
  approveIds?: string[];
  applyOk?: boolean;
}): { flow: DiffApplyFlow; capture: Capture } {
  const logs: string[] = [];
  const infos: string[] = [];
  const presents: Capture['presents'] = [];

  const diffPresenter = new DiffPresenter({
    async openTextDocument(o) {
      return { uri: { toString: () => `untitled:${o.content.length}` } };
    },
    async executeCommand(_cmd, ..._args) {
      presents.push({
        originalUri: _args[0] as UriLike,
        revised: opts.revised,
        title: _args[2] as string,
      });
      return undefined;
    },
  });

  const hunkApprover = new HunkApprover({
    async showMultiPick(items, _options) {
      if (opts.approveAll === false) return undefined;
      const idsToApprove = opts.approveIds ?? items.map((i) => i.id);
      return items.filter((i) => idsToApprove.includes(i.id));
    },
  });

  const workspaceEditBuilder = new WorkspaceEditBuilder({
    async apply(_uri, replacements) {
      logs.push(`[fake-apply] count=${replacements.length}`);
      return opts.applyOk !== false;
    },
  });

  const deps: DiffApplyFlowDeps = {
    hunkComputer: new HunkComputer(),
    diffPresenter,
    hunkApprover,
    workspaceEditBuilder,
    logger: {
      appendLine(line) {
        logs.push(line);
      },
    },
    notifier: {
      async info(m) {
        infos.push(m);
      },
      async askRetry(m) {
        infos.push(m);
        return false;
      },
    },
  };
  return { flow: new DiffApplyFlow(deps), capture: { logs, infos, presents } };
}

const uri: UriLike = { toString: () => 'file:///foo.md' };

describe('DiffApplyFlow', () => {
  it('변경 없는 응답이면 no-changes outcome + 정보 토스트', async () => {
    const { flow, capture } = makeFlow({
      originalText: 'a\nb',
      revised: 'a\nb',
    });
    const out = await flow.run({
      documentUri: uri,
      documentText: 'a\nb',
      revisedMarkdown: 'a\nb',
      fileName: 'foo.md',
    });
    expect(out).to.deep.equal({ kind: 'no-changes' });
    expect(capture.infos).to.have.lengthOf(1);
    expect(capture.infos[0]).to.contain('변경 사항이 없습니다');
    expect(capture.presents).to.have.lengthOf(0);
  });

  it('사용자가 모두 거부(취소)하면 no-approval outcome', async () => {
    const { flow, capture } = makeFlow({
      originalText: 'a\nb',
      revised: 'a\nX',
      approveAll: false,
    });
    const out = await flow.run({
      documentUri: uri,
      documentText: 'a\nb',
      revisedMarkdown: 'a\nX',
      fileName: 'foo.md',
    });
    expect(out).to.deep.equal({ kind: 'no-approval' });
    expect(capture.presents).to.have.lengthOf(1);
    expect(capture.infos.some((m) => m.includes('적용된 hunk가 없습니다'))).to.equal(true);
  });

  it('승인된 hunk가 있으면 applied outcome + appliedCount 반환', async () => {
    const { flow, capture } = makeFlow({
      originalText: 'a\nb\nc',
      revised: 'a\nX\nc',
    });
    const out = await flow.run({
      documentUri: uri,
      documentText: 'a\nb\nc',
      revisedMarkdown: 'a\nX\nc',
      fileName: 'foo.md',
    });
    expect(out.kind).to.equal('applied');
    if (out.kind === 'applied') {
      expect(out.appliedCount).to.equal(1);
    }
    expect(capture.logs.some((l) => l.includes('[mdReview] hunks='))).to.equal(true);
    expect(capture.logs.some((l) => l.includes('[mdReview] applied=1'))).to.equal(true);
    expect(capture.infos.some((m) => m.includes('1개 hunk를 본문에 반영'))).to.equal(true);
  });

  it('diff present는 hunks>0일 때만 호출된다', async () => {
    const { flow, capture } = makeFlow({
      originalText: 'a\nb',
      revised: 'a\nb',
    });
    await flow.run({
      documentUri: uri,
      documentText: 'a\nb',
      revisedMarkdown: 'a\nb',
      fileName: 'foo.md',
    });
    expect(capture.presents).to.have.lengthOf(0);
  });

  it('title은 mdReview: {fileName} 형식', async () => {
    const { flow, capture } = makeFlow({
      originalText: 'a\nb',
      revised: 'a\nX',
    });
    await flow.run({
      documentUri: uri,
      documentText: 'a\nb',
      revisedMarkdown: 'a\nX',
      fileName: 'review.md',
    });
    expect(capture.presents[0].title).to.equal('mdReview: review.md');
  });
});
