import { expect } from 'chai';
import {
  WebViewBridge,
  type OutputSink,
  type WebViewLike,
} from '../../src/editor/WebViewBridge';

function fakeOutput(): OutputSink & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    appendLine(msg: string) {
      lines.push(msg);
    },
  };
}

interface FakeWebView extends WebViewLike {
  sent: unknown[];
  emit(raw: unknown): Promise<void>;
}

function fakeWebView(): FakeWebView {
  const sent: unknown[] = [];
  let listener: ((e: unknown) => void | Promise<void>) | null = null;
  return {
    sent,
    async postMessage(m) {
      sent.push(m);
      return true;
    },
    onDidReceiveMessage(l) {
      listener = l;
      return {
        dispose() {
          listener = null;
        },
      };
    },
    async emit(raw) {
      if (listener) {
        await listener(raw);
      }
    },
  };
}

describe('WebViewBridge', () => {
  it('post — sends host message after schema validation', async () => {
    const out = fakeOutput();
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, out);
    await bridge.post({ type: 'renderUpdate', html: '<p>x</p>', source: '# x' });
    expect(wv.sent).to.have.lengthOf(1);
  });

  it('post — invalid host message throws via zod (programmer error)', async () => {
    const out = fakeOutput();
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, out);
    let threw = false;
    try {
      await bridge.post({ type: 'renderUpdate' } as unknown as never);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });

  it('onMessage — valid message reaches handler', async () => {
    const out = fakeOutput();
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, out);

    const seen: unknown[] = [];
    bridge.onMessage((m) => {
      seen.push(m);
    });
    await wv.emit({ type: 'submit' });
    expect(seen).to.have.lengthOf(1);
    expect((seen[0] as { type: string }).type).to.equal('submit');
  });

  it('onMessage — invalid message is dropped and logged', async () => {
    const out = fakeOutput();
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, out);

    const seen: unknown[] = [];
    bridge.onMessage((m) => {
      seen.push(m);
    });
    await wv.emit({ type: 'noSuch' });
    expect(seen).to.have.lengthOf(0);
    expect(out.lines).to.have.lengthOf(1);
    expect(out.lines[0]).to.match(/dropped invalid message/);
  });
});
