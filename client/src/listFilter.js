const listFilterTag = 'list-filter';

/**
 * A live search filter for any column list.
 *
 * Drop a <list-filter for="some-list-id"> tag for a list, and it becomes
 * instantly filterable. As the user types, matching items get their matching
 * portion highlighted in bold. Non-matching items remain visible but unhighlighted.
 * The first match is automatically focused so the user can hit Enter to select it
 * without reaching for the mouse. Arrow keys cycle through matches (wrapping at
 * both ends), and Escape clears the filter and restores the full list.
 *
 * When the list is reloaded from the server, call clearFilter() or
 * ListFilter.clearAllFilters() to reset the search box and show everything again.
 */
class ListFilter extends HTMLElement {

    static clearAllFilters() {
        document.querySelectorAll(listFilterTag).forEach(listFilter => listFilter.clearFilter());
    }

    static refreshFilterOf(listElement) {
        this.#filterFor(listElement)?.applyFilter();
    }

    static #filterFor(listElement) {
        // An empty id would produce [for=""], matching any list-filter with a missing or blank
        // 'for' attribute — a phantom match that would apply the filter to the wrong list.
        if (!listElement.id) return undefined;

        const filters = document.querySelectorAll(`${listFilterTag}[for="${CSS.escape(listElement.id)}"]`);
        if (filters.length > 1) {
            throw new Error(`Found ${filters.length} list-filter elements for #${listElement.id} — only one filter per list is supported.`);
        }

        return filters[0];
    }

    constructor() {
        super();
        this.debounceTimer = null;
        this.listElement = null;
        this.searchBox = null;
        this.initializeMatchedItems();
    }

    connectedCallback() {
        this.injectStyles();
        this.innerHTML = '<input type="text" placeholder="Filter…" autocomplete="off" spellcheck="false"><button class="clear-btn" tabindex="-1" title="Clear filter">✕</button>';
        this.searchBox = this.querySelector('input');
        this.searchBox.addEventListener('input', this.onQueryChanged.bind(this));
        this.searchBox.addEventListener('keydown', this.onKeydown.bind(this));
        this.querySelector('.clear-btn').addEventListener('click', this.onClearFilterClick.bind(this));
    }


    // Keyboard and input handling

    onQueryChanged() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.applyFilter(), 150);
    }

    onKeydown(e) {
        if (e.key === 'Escape') return this.clearFilter();
        if (e.key === 'Enter') return this.clickFocusedItem();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') this.onArrowKeyPressed(e);
    }

    onArrowKeyPressed(e) {
        if (!this.matchedItems.length) return;
        
        e.preventDefault();
        const offset = e.key === 'ArrowUp' ? -1 : 1;

        this.removeKeyboardIndicatorFromFocusedItem();
        this.moveFocusedItemBy(offset);
        this.addKeyboardIndicatorToFocusedItem();
    }

    onClearFilterClick() {
        this.clearFilter();
        this.searchBox.focus();
    }


    // Filtering

    query() {
        return this.searchBox.value.trim();
    }

    clearFilter() {
        this.searchBox.value = '';
        this.applyFilter();
    }

    applyFilter() {
        const query = this.query().toLowerCase();
        this.toggleClearFilterButtonVisibility();
        this.clearMatchedItems();

        for (const item of this.listItems()) {
            this.applyFilterToItem(item, query);
        }

        this.focusFirstMatchedItem();
    }

    applyFilterToItem(item, query) {
        if (!item.dataset.value) return;

        if (!query) {
            return this.renderUnmatchedItem(item);
        }

        const match = this.matchQuery(item.dataset.value, query);
        if (!match) {
            return this.renderUnmatchedItem(item);
        }

        this.renderMatchedItem(item, match);
    }

    toggleClearFilterButtonVisibility() {
        this.classList.toggle('has-text', this.query().length > 0);
    }

    clearMatchedItems() {
        this.removeKeyboardIndicatorFromFocusedItem();
        this.initializeMatchedItems();
    }

    initializeMatchedItems() {
        this.matchedItems = [];
        this.focusedIndex = -1;
    }

    matchQuery(text, query) {
        const start = text.toLowerCase().indexOf(query);
        
        if (start === -1) return null;
        
        return {start, end: start + query.length, text};
    }


    // Matched item rendering

    // Clear the item's text while keeping any leading indicator elements
    // (override arrows, session-method glyph) that were rendered before the
    // selector text. querySelectorAll returns them in document order, so their
    // original leading order is preserved when re-appended.
    clearItemText(item) {
        const keep = [...item.querySelectorAll(':scope > .override-arrow, :scope > .session-indicator')];
        item.textContent = '';
        for (const el of keep) item.appendChild(el);
    }

    renderUnmatchedItem(item) {
        this.clearItemText(item);
        item.appendChild(document.createTextNode(item.dataset.value));
    }

    renderMatchedItem(item, match) {
        this.clearItemText(item);

        this.renderTextBeforeMatch(item, match);
        this.renderHighlightedMatch(item, match);
        this.renderTextAfterMatch(item, match);

        this.matchedItems.push(item);
    }

    renderTextBeforeMatch(item, match) {
        if (match.start <= 0) return;

        item.appendChild(document.createTextNode(match.text.slice(0, match.start)));
    }

    renderHighlightedMatch(item, match) {
        const highlight = document.createElement('span');

        highlight.className = 'match-highlight';
        highlight.textContent = match.text.slice(match.start, match.end);

        item.appendChild(highlight);
    }

    renderTextAfterMatch(item, match) {
        if (match.end >= match.text.length) return;

        item.appendChild(document.createTextNode(match.text.slice(match.end)));
    }


    // Keyboard focus

    clickFocusedItem() {
        this.matchedItems[this.focusedIndex]?.click();
        this.searchBox.focus();
    }

    focusFirstMatchedItem() {
        if (this.matchedItems.length === 0) return;

        this.focusedIndex = 0;
        this.addKeyboardIndicatorToFocusedItem();
    }

    moveFocusedItemBy(offset) {
        const desiredFocusedIndex = this.focusedIndex + offset;

        this.focusedIndex = desiredFocusedIndex < 0
            ? this.matchedItems.length - 1
            : desiredFocusedIndex % this.matchedItems.length;
    }

    addKeyboardIndicatorToFocusedItem() {
        this.matchedItems[this.focusedIndex].classList.add('keyboard-cursor');

        this.scrollFocusedItemIntoView();
    }

    removeKeyboardIndicatorFromFocusedItem() {
        this.matchedItems[this.focusedIndex]?.classList.remove('keyboard-cursor');
    }
    
    scrollFocusedItemIntoView() {
        this.matchedItems[this.focusedIndex].scrollIntoView({block: 'nearest'});
    }


    // List access

    list() {
        // getElementById may return null if the list hasn't been added to the DOM yet.
        // Callers must handle a null return gracefully.
        return this.listElement ??= document.getElementById(this.getAttribute('for'));
    }

    listItems() {
        return this.list()?.children || [];
    }


    // Style injection

    injectStyles() {
        const styleId = 'list-filter-styles';
        
        if (document.getElementById(styleId)) return;
        
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            list-filter {
                position: relative;
                padding: 3px 6px;
                border-bottom: 1px solid var(--vscode-panel-border);
                flex-shrink: 0;
            }
            list-filter input {
                width: 100%;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border, transparent);
                border-radius: 2px;
                padding: 2px 20px 2px 4px;
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                outline: none;
            }
            list-filter input:focus {
                border-color: var(--vscode-focusBorder);
            }
            list-filter .clear-btn {
                position: absolute;
                right: 9px;
                top: 50%;
                transform: translateY(-50%);
                visibility: hidden;
                background: none;
                border: none;
                padding: 0 2px;
                cursor: pointer;
                color: var(--vscode-descriptionForeground);
                font-size: 14px;
                line-height: 1;
            }
            list-filter .clear-btn:hover {
                color: var(--vscode-foreground);
            }
            list-filter.has-text .clear-btn {
                visibility: visible;
            }
            .match-highlight {
                font-weight: bold;
                color: var(--vscode-list-highlightForeground);
            }
            .item.keyboard-cursor {
                outline: 1px solid var(--vscode-focusBorder);
                outline-offset: -1px;
            }
        `;
        
        document.head.appendChild(style);
    }

}

customElements.define(listFilterTag, ListFilter);