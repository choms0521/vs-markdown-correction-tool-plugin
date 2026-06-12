import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  TerminationDetector,
  TerminationDetectorOptions,
} from '../../src/pty/TerminationDetector';

describe('TerminationDetector — Edit-1 + Edit-10 + v3-Edit-1 echo case 6 scenarios', () => {
  let clock: sinon.SinonFakeTimers;
  const uuid = 'test-uuid-001';
  const envelopeEnd = `<<<END-${uuid}>>>`;
  const sentinel = `<<<DONE-${uuid}>>>`;
  const baseOpts: TerminationDetectorOptions = {
    envelopeEnd,
    sentinel,
    shellPromptRegex: /\n\s*│\s*>\s*$/m,
    hardTimeoutMs: 90_000,
    quietPeriodMs: 200,
  };

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  it('case 1: sentinel appearing inside echo region must not resolve', () => {
    const resolveSpy = sinon.spy();
    const rejectSpy = sinon.spy();
    const d = new TerminationDetector(baseOpts, resolveSpy, rejectSpy);

    // PROMPT_END has NOT yet appeared — the sentinel inside the echoed
    // prompt body must be ignored by Stage A.
    d.feed(`<<<BEGIN-${uuid}>>>\nedit instruction with ${sentinel}\n`);
    clock.tick(300);

    expect(resolveSpy.called).to.equal(false);
    expect(rejectSpy.called).to.equal(false);
    d.dispose();
  });

  it('case 2: single sentinel after PROMPT_END resolves after 200ms quiet period', () => {
    const resolveSpy = sinon.spy();
    const rejectSpy = sinon.spy();
    const d = new TerminationDetector(baseOpts, resolveSpy, rejectSpy);

    d.feed(`prompt echo... ${envelopeEnd}response body\n${sentinel}`);
    expect(resolveSpy.called).to.equal(false);

    clock.tick(200);
    expect(resolveSpy.calledOnce).to.equal(true);
    expect(resolveSpy.firstCall.args[0]).to.equal('response body');
    d.dispose();
  });

  it('case 3: duplicate sentinel uses lastIndexOf (R-15)', () => {
    const resolveSpy = sinon.spy();
    const rejectSpy = sinon.spy();
    const d = new TerminationDetector(baseOpts, resolveSpy, rejectSpy);

    d.feed(`${envelopeEnd}body A ${sentinel}\nbody B ${sentinel}`);
    clock.tick(200);

    expect(resolveSpy.calledOnce).to.equal(true);
    expect(resolveSpy.firstCall.args[0]).to.equal(
      `body A ${sentinel}\nbody B`,
    );
    d.dispose();
  });

  it('case 4: shell prompt regex match resolves via Stage B2', () => {
    const resolveSpy = sinon.spy();
    const rejectSpy = sinon.spy();
    const d = new TerminationDetector(baseOpts, resolveSpy, rejectSpy);

    d.feed(`${envelopeEnd}response body\n│ > `);

    expect(resolveSpy.calledOnce).to.equal(true);
    d.dispose();
  });

  it('case 5: no signal within 90s rejects via Stage B3', () => {
    const resolveSpy = sinon.spy();
    const rejectSpy = sinon.spy();
    const d = new TerminationDetector(baseOpts, resolveSpy, rejectSpy);

    d.feed(`${envelopeEnd}stuck...`);
    clock.tick(90_000);

    expect(rejectSpy.calledOnce).to.equal(true);
    expect(rejectSpy.firstCall.args[0]).to.be.instanceOf(Error);
    d.dispose();
  });

  it('case 6 (v3-Edit-1): extra chunk during quiet period resets timer (R-16)', () => {
    const resolveSpy = sinon.spy();
    const rejectSpy = sinon.spy();
    const d = new TerminationDetector(baseOpts, resolveSpy, rejectSpy);

    d.feed(`${envelopeEnd}response body\n${sentinel}`);
    clock.tick(150);
    expect(resolveSpy.called).to.equal(false);

    d.feed(`\nextra closing remark\n${sentinel}`);
    clock.tick(150);
    expect(resolveSpy.called).to.equal(false);

    clock.tick(200);
    expect(resolveSpy.calledOnce).to.equal(true);
    expect(resolveSpy.firstCall.args[0]).to.equal(
      `response body\n${sentinel}\nextra closing remark`,
    );
    d.dispose();
  });
});
