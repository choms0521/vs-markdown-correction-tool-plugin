export class CommentPanel {
    constructor(listRoot, submitBtn, handlers) {
        this.listRoot = listRoot;
        this.submitBtn = submitBtn;
        this.handlers = handlers;
        this.comments = [];
        this.submitBtn.addEventListener('click', () => this.handlers.onSubmit());
    }
    setComments(comments) {
        this.comments = comments;
        this.render();
    }
    render() {
        this.listRoot.innerHTML = '';
        for (const c of this.comments) {
            const li = document.createElement('li');
            li.setAttribute('data-comment-id', c.id);
            li.addEventListener('click', () => this.handlers.onItemClick(c.id));
            const kind = document.createElement('span');
            kind.className = `kind ${c.type}`;
            kind.textContent = c.type === 'suggestion' ? '제안' : '질문';
            li.appendChild(kind);
            const body = document.createElement('div');
            body.className = 'body';
            body.textContent = this.summarize(c);
            li.appendChild(body);
            this.listRoot.appendChild(li);
        }
    }
    summarize(c) {
        if (c.type === 'suggestion' && (c.before || c.after)) {
            return `${c.before ?? '(빈 원본)'} → ${c.after ?? '(빈 제안)'}`;
        }
        return c.note ?? '(내용 없음)';
    }
}
//# sourceMappingURL=comment-panel.js.map