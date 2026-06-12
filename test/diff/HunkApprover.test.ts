import { expect } from 'chai';
import {
  HunkApprover,
  type QuickPickBridge,
  type QuickPickItemLite,
} from '../../src/diff/HunkApprover';
import { type Hunk } from '../../src/diff/types';

function makeHunks(): Hunk[] {
  return [
    {
      id: 'h0',
      beforeRange: { startLine: 0, endLineExclusive: 1 },
      beforeText: 'old line 0',
      afterText: 'new line 0',
      kind: 'replace',
    },
    {
      id: 'h1',
      beforeRange: { startLine: 5, endLineExclusive: 5 },
      beforeText: '',
      afterText: 'inserted',
      kind: 'insert',
    },
    {
      id: 'h2',
      beforeRange: { startLine: 10, endLineExclusive: 12 },
      beforeText: 'a\nb',
      afterText: '',
      kind: 'delete',
    },
  ];
}

interface CapturingBridge extends QuickPickBridge {
  invocations: {
    items: QuickPickItemLite[];
    options: { title: string; placeHolder: string };
  }[];
  setNextResult(items: QuickPickItemLite[] | undefined): void;
}

function makeBridge(): CapturingBridge {
  const invocations: CapturingBridge['invocations'] = [];
  let next: QuickPickItemLite[] | undefined;
  return {
    invocations,
    setNextResult(items) {
      next = items;
    },
    async showMultiPick(items, options) {
      invocations.push({ items, options });
      return next;
    },
  };
}

describe('HunkApprover', () => {
  it('빈 hunks는 bridge를 호출하지 않고 빈 Set을 반환한다', async () => {
    const bridge = makeBridge();
    const ap = new HunkApprover(bridge);
    const r = await ap.askApprovals([]);
    expect(r.size).to.equal(0);
    expect(bridge.invocations).to.have.lengthOf(0);
  });

  it('bridge에 전달되는 items 길이는 hunks 길이와 같고 모두 picked=true', async () => {
    const bridge = makeBridge();
    bridge.setNextResult([]);
    const ap = new HunkApprover(bridge);
    const hunks = makeHunks();
    await ap.askApprovals(hunks);
    const inv = bridge.invocations[0];
    expect(inv.items).to.have.lengthOf(3);
    expect(inv.items.every((i) => i.picked === true)).to.equal(true);
    expect(inv.items.map((i) => i.id)).to.deep.equal(['h0', 'h1', 'h2']);
  });

  it('사용자가 일부 선택 시 해당 id Set 반환', async () => {
    const bridge = makeBridge();
    const ap = new HunkApprover(bridge);
    bridge.setNextResult([
      { id: 'h0', label: '', picked: true },
      { id: 'h2', label: '', picked: true },
    ]);
    const r = await ap.askApprovals(makeHunks());
    expect([...r].sort()).to.deep.equal(['h0', 'h2']);
  });

  it('사용자 취소(undefined) 시 빈 Set 반환', async () => {
    const bridge = makeBridge();
    bridge.setNextResult(undefined);
    const ap = new HunkApprover(bridge);
    const r = await ap.askApprovals(makeHunks());
    expect(r.size).to.equal(0);
  });

  it('label은 H1, H2 인덱스와 라인 범위, +/- 카운트를 포함한다', async () => {
    const bridge = makeBridge();
    bridge.setNextResult([]);
    const ap = new HunkApprover(bridge);
    await ap.askApprovals(makeHunks());
    const labels = bridge.invocations[0].items.map((i) => i.label);
    expect(labels[0]).to.contain('H1');
    expect(labels[0]).to.contain('L1');
    expect(labels[1]).to.contain('H2');
    expect(labels[2]).to.contain('H3');
    expect(labels[2]).to.contain('-2');
    expect(labels[2]).to.contain('+0');
  });

  it('title/placeHolder가 QuickPick options로 전달된다', async () => {
    const bridge = makeBridge();
    bridge.setNextResult([]);
    const ap = new HunkApprover(bridge);
    await ap.askApprovals(makeHunks());
    const opts = bridge.invocations[0].options;
    expect(opts.title).to.contain('hunk');
    expect(opts.placeHolder).to.contain('Esc');
  });
});
