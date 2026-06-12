import { InlineOverlay } from './inline-overlay';
import { CommentPanel } from './comment-panel';
const MAX_PAYLOAD = 2048;
const api = acquireVsCodeApi();
const docBody = document.getElementById('doc-body');
const overlayRoot = document.getElementById('overlay-root');
const commentList = document.getElementById('comment-list');
const submitBtn = document.getElementById('submit-btn');
function postWithBudget(payload) {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_PAYLOAD) {
        console.warn('[mdReview] payload exceeds 2KB; refusing to send');
        return;
    }
    api.postMessage(payload);
}
const panel = new CommentPanel(commentList, submitBtn, {
    onSubmit: () => postWithBudget({ type: 'submit' }),
    onItemClick: (id) => scrollToAnchor(id),
});
new InlineOverlay(overlayRoot, (selection, kind) => {
    postWithBudget({
        type: 'addComment',
        kind,
        anchor: {
            line: selection.startLine,
            col: selection.startColInLine,
            length: selection.length,
        },
        note: kind === 'question' ? selection.text : undefined,
        before: kind === 'suggestion' ? selection.text : undefined,
        after: kind === 'suggestion' ? selection.text : undefined,
    });
});
window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg.type !== 'string')
        return;
    switch (msg.type) {
        case 'renderUpdate':
            docBody.innerHTML = msg.html;
            break;
        case 'commentsUpdate':
            panel.setComments(msg.comments);
            break;
        case 'submitAck':
            // host에서 안내 toast를 표시하므로 별도 처리 없음.
            break;
    }
});
function scrollToAnchor(commentId) {
    const el = commentList.querySelector(`[data-comment-id="${commentId}"]`);
    if (!el)
        return;
    el.classList.add('is-highlighted');
    window.setTimeout(() => el.classList.remove('is-highlighted'), 1500);
}
//# sourceMappingURL=main.js.map