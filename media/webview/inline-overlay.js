export class InlineOverlay {
    constructor(root, onAdd) {
        this.root = root;
        this.onAdd = onAdd;
        this.buttons = null;
        this.debounceHandle = null;
        document.addEventListener('selectionchange', () => this.handleSelectionChange());
    }
    handleSelectionChange() {
        if (this.debounceHandle !== null) {
            window.clearTimeout(this.debounceHandle);
        }
        this.debounceHandle = window.setTimeout(() => this.evaluateSelection(), 50);
    }
    evaluateSelection() {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
            this.hide();
            return;
        }
        const range = sel.getRangeAt(0);
        const docBody = document.getElementById('doc-body');
        if (!docBody || !docBody.contains(range.startContainer)) {
            this.hide();
            return;
        }
        const lineAttrEl = this.findLineAttrAncestor(range.startContainer);
        const startLine = lineAttrEl
            ? Number(lineAttrEl.getAttribute('data-line') ?? '0')
            : 0;
        const text = sel.toString();
        if (text.length === 0) {
            this.hide();
            return;
        }
        const rect = range.getBoundingClientRect();
        this.show(rect, {
            startLine,
            startColInLine: range.startOffset,
            length: text.length,
            text,
        });
    }
    findLineAttrAncestor(node) {
        let cur = node;
        while (cur) {
            if (cur.nodeType === Node.ELEMENT_NODE) {
                const el = cur;
                if (el.hasAttribute && el.hasAttribute('data-line')) {
                    return el;
                }
            }
            cur = cur.parentNode;
        }
        return null;
    }
    show(rect, selection) {
        if (!this.buttons) {
            this.buttons = document.createElement('div');
            this.buttons.className = 'overlay-buttons';
            this.root.appendChild(this.buttons);
        }
        this.buttons.style.top = `${window.scrollY + rect.top - 38}px`;
        this.buttons.style.left = `${window.scrollX + rect.left}px`;
        this.buttons.innerHTML = '';
        this.buttons.appendChild(this.makeButton('suggestion', selection));
        this.buttons.appendChild(this.makeButton('question', selection));
    }
    makeButton(type, selection) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = type === 'suggestion' ? '제안 추가' : '질문 추가';
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
            this.onAdd(selection, type);
            this.hide();
        });
        return btn;
    }
    hide() {
        if (this.buttons) {
            this.buttons.remove();
            this.buttons = null;
        }
    }
}
//# sourceMappingURL=inline-overlay.js.map