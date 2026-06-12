import { expect } from 'chai';
import {
  WorkspaceEditBuilder,
  type EditApplier,
  type Replacement,
  type UriLike,
} from '../../src/diff/WorkspaceEditBuilder';
import { type Hunk } from '../../src/diff/types';

interface FakeApplier extends EditApplier {
  invocations: { uri: UriLike; replacements: readonly Replacement[] }[];
  setApplyResult(ok: boolean): void;
}

function makeApplier(): FakeApplier {
  const invocations: FakeApplier['invocations'] = [];
  let result = true;
  return {
    invocations,
    setApplyResult(ok) {
      result = ok;
    },
    async apply(uri, replacements) {
      invocations.push({ uri, replacements });
      return result;
    },
  };
}

function hunks(): Hunk[] {
  return [
    {
      id: 'h0',
      beforeRange: { startLine: 2, endLineExclusive: 3 },
      beforeText: 'old2',
      afterText: 'new2',
      kind: 'replace',
    },
    {
      id: 'h1',
      beforeRange: { startLine: 10, endLineExclusive: 12 },
      beforeText: 'a\nb',
      afterText: 'c\nd',
      kind: 'replace',
    },
    {
      id: 'h2',
      beforeRange: { startLine: 20, endLineExclusive: 20 },
      beforeText: '',
      afterText: 'inserted',
      kind: 'insert',
    },
  ];
}

const uri: UriLike = { toString: () => 'file:///foo.md' };

describe('WorkspaceEditBuilder', () => {
  it('approvedIds가 비어있으면 applier를 호출하지 않고 appliedCount=0', async () => {
    const ap = makeApplier();
    const b = new WorkspaceEditBuilder(ap);
    const r = await b.buildAndApply(uri, hunks(), new Set());
    expect(r.appliedCount).to.equal(0);
    expect(ap.invocations).to.have.lengthOf(0);
  });

  it('승인된 hunk만 replacements에 포함된다', async () => {
    const ap = makeApplier();
    const b = new WorkspaceEditBuilder(ap);
    const r = await b.buildAndApply(uri, hunks(), new Set(['h1']));
    expect(r.appliedCount).to.equal(1);
    expect(ap.invocations).to.have.lengthOf(1);
    expect(ap.invocations[0].replacements).to.have.lengthOf(1);
    expect(ap.invocations[0].replacements[0].startLine).to.equal(10);
  });

  it('다중 hunk는 startLine 내림차순으로 replacements에 들어간다', async () => {
    const ap = makeApplier();
    const b = new WorkspaceEditBuilder(ap);
    await b.buildAndApply(uri, hunks(), new Set(['h0', 'h1', 'h2']));
    const lines = ap.invocations[0].replacements.map((r) => r.startLine);
    expect(lines).to.deep.equal([20, 10, 2]);
  });

  it('replace 텍스트는 afterText + 개행을 포함한다', async () => {
    const ap = makeApplier();
    const b = new WorkspaceEditBuilder(ap);
    await b.buildAndApply(uri, hunks(), new Set(['h0']));
    expect(ap.invocations[0].replacements[0].newText).to.equal('new2\n');
  });

  it('순수 delete hunk는 빈 문자열로 replacement된다', async () => {
    const ap = makeApplier();
    const b = new WorkspaceEditBuilder(ap);
    const dh: Hunk = {
      id: 'd0',
      beforeRange: { startLine: 5, endLineExclusive: 7 },
      beforeText: 'a\nb',
      afterText: '',
      kind: 'delete',
    };
    await b.buildAndApply(uri, [dh], new Set(['d0']));
    expect(ap.invocations[0].replacements[0].newText).to.equal('');
  });

  it('Range 컬럼은 (startLine, 0) - (endLine, 0)', async () => {
    const ap = makeApplier();
    const b = new WorkspaceEditBuilder(ap);
    await b.buildAndApply(uri, hunks(), new Set(['h1']));
    const r = ap.invocations[0].replacements[0];
    expect(r).to.deep.include({
      startLine: 10,
      startCol: 0,
      endLine: 12,
      endCol: 0,
    });
  });

  it('applier가 false 반환 시 throw', async () => {
    const ap = makeApplier();
    ap.setApplyResult(false);
    const b = new WorkspaceEditBuilder(ap);
    let threw: Error | null = null;
    try {
      await b.buildAndApply(uri, hunks(), new Set(['h0']));
    } catch (e) {
      threw = e as Error;
    }
    expect(threw).to.be.instanceOf(Error);
    expect(threw?.message).to.match(/applyEdit/);
  });
});
