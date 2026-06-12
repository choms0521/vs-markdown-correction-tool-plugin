import { expect } from 'chai';
import { CommentSession } from '../../src/editor/CommentSession';
import { CommentStore } from '../../src/store/CommentStore';
import {
  WebViewBridge,
  type OutputSink,
  type WebViewLike,
} from '../../src/editor/WebViewBridge';
import type { Comment } from '../../src/model/Comment';
import type { PersistenceBackend } from '../../src/store/PersistenceBackend';

function makeBackend(): PersistenceBackend & {
  saved: { uri: string; comments: readonly Comment[] }[];
} {
  const saved: { uri: string; comments: readonly Comment[] }[] = [];
  return {
    saved,
    backendName: 'sidecar' as const,
    async load() {
      return [];
    },
    async save(uri, comments) {
      saved.push({ uri, comments });
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
      return { dispose() { listener = null; } };
    },
    async emit(raw) {
      if (listener) await listener(raw);
    },
  };
}

const noopOutput: OutputSink = { appendLine() { /* noop */ } };

function fakeDoc(uri: string): { uri: { toString(): string } } {
  return { uri: { toString: () => uri } };
}

describe('CommentSession', () => {
  it('start — loads comments without pushing to webview (deadlock guard)', async () => {
    const backend = makeBackend();
    const store = new CommentStore(backend);
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, noopOutput);
    const session = new CommentSession(fakeDoc('file:///doc.md'), store, bridge);

    await session.start('<p>hi</p>', '# src');

    expect(wv.sent).to.have.lengthOf(0);
    await session.dispose();
  });

  it('ready — pushes renderUpdate + commentsUpdate with latest body', async () => {
    const backend = makeBackend();
    const store = new CommentStore(backend);
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, noopOutput);
    const session = new CommentSession(fakeDoc('file:///doc.md'), store, bridge);

    await session.start('<p>hi</p>', '# src');
    await wv.emit({ type: 'ready' });

    expect(wv.sent).to.have.lengthOf(2);
    expect(wv.sent[0]).to.deep.equal({
      type: 'renderUpdate',
      html: '<p>hi</p>',
      source: '# src',
    });
    expect((wv.sent[1] as { type: string }).type).to.equal('commentsUpdate');

    session.updateBody('<p>v2</p>', '# src v2');
    await wv.emit({ type: 'ready' });
    expect(wv.sent.at(-2)).to.deep.equal({
      type: 'renderUpdate',
      html: '<p>v2</p>',
      source: '# src v2',
    });

    await session.dispose();
  });

  it('addComment — invokes store.save after debounce and echoes commentsUpdate', async () => {
    const backend = makeBackend();
    const store = new CommentStore(backend);
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, noopOutput);
    const session = new CommentSession(
      fakeDoc('file:///doc.md'),
      store,
      bridge,
      { saveDebounceMs: 10 },
    );

    await session.start('<p>hi</p>', '# src');
    await wv.emit({
      type: 'addComment',
      kind: 'suggestion',
      anchor: { line: 0, col: 0, length: 3 },
      before: 'foo',
      after: 'bar',
    });

    expect(session.getComments()).to.have.lengthOf(1);
    expect(wv.sent.at(-1)).to.deep.include({ type: 'commentsUpdate' });

    await new Promise((r) => setTimeout(r, 50));
    expect(backend.saved).to.have.lengthOf(1);
    expect(backend.saved[0].uri).to.equal('file:///doc.md');
    expect(backend.saved[0].comments).to.have.lengthOf(1);

    await session.dispose();
  });

  it('submit — invokes attached submit handler with current comments', async () => {
    const backend = makeBackend();
    const store = new CommentStore(backend);
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, noopOutput);
    const session = new CommentSession(fakeDoc('file:///doc.md'), store, bridge);

    const seen: { comments: readonly Comment[] }[] = [];
    session.attachSubmitHandler(async (comments) => {
      seen.push({ comments });
    });

    await session.start('<p>x</p>', '# src');
    await wv.emit({ type: 'submit' });

    expect(seen).to.have.lengthOf(1);
    expect(wv.sent.at(-1)).to.deep.include({ type: 'submitAck' });

    await session.dispose();
  });

  it('dispose — flushes pending save before resolving', async () => {
    const backend = makeBackend();
    const store = new CommentStore(backend);
    const wv = fakeWebView();
    const bridge = new WebViewBridge(wv, noopOutput);
    const session = new CommentSession(
      fakeDoc('file:///doc.md'),
      store,
      bridge,
      { saveDebounceMs: 5000 },
    );

    await session.start('<p>x</p>', '# src');
    await wv.emit({
      type: 'addComment',
      kind: 'question',
      anchor: { line: 0, col: 0, length: 0 },
      note: '?',
    });

    expect(backend.saved).to.have.lengthOf(0);
    await session.dispose();
    expect(backend.saved).to.have.lengthOf(1);
  });
});
