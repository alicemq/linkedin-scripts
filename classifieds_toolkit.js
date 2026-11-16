// ==UserScript==
// @name         Classifieds Toolkit
// @namespace    https://github.com/alicemq/linkedin-scripts
// @version      0.1.0
// @description  Organize classified ads with filters, blocking, and side-by-side details
// @match        https://www.skelbiu.lt/skelbimai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(async function () {
    'use strict';
    if (window.top !== window.self) return;

    const STORAGE_KEY = 'classifiedsToolkitSettings';
    const PAGINATION_KEY = 'classifiedsToolkitPagination';
    const SPLIT_VIEW_MIN_WIDTH = 1200;
    const FILTERS = {
        SHOW_ALL: 'SHOW_ALL',
        SHOW_PROMOTED: 'SHOW_PROMOTED',
        SHOW_NORMAL: 'SHOW_NORMAL'
    };
    const DEFAULTS = {
        activeFilter: FILTERS.SHOW_ALL,
        onlyUnviewed: false,
        onlyUnhidden: false,
        onlyUnapplied: false,
        blockedPhrases: [],
        blockedEmployers: [],
        blockedEmployerPositions: [],
        blockedPositions: [],
        viewedItems: [],
        hiddenJobs: [],
        appliedJobs: [],
        minimumPrice: 0,
        maximumPrice: 0,
        splitViewWidths: { skelbiu: { mainWidth: 55 } }
    };

    const portals = [{
        id: 'skelbiu',
        matches: () => location.hostname === 'www.skelbiu.lt'
            && /^\/skelbimai(?:\/|$)/.test(location.pathname)
            && !/\.html$/i.test(location.pathname),
        getCards: () => Array.from(document.querySelectorAll(
            '#items-list-container a.js-cfuser-link.standard-list-item[href*="/skelbimai/"]'
        )).filter(card => /\/skelbimai\/[^/]+-\d+\.html$/i.test(card.href)),
        getUrl: card => card.href,
        getTitle: card => card.querySelector('h2, h3, .title, .item-title')?.innerText.trim()
            || card.innerText.trim().split('\n').map(line => line.trim()).find(Boolean)
            || '',
        getSeller: card => card.querySelector('.seller-name, .user-name, [data-seller-name]')
            ?.innerText.trim() || '',
        getListingText: card => card.innerText,
        getPriceText: card => card.innerText,
        getCardToolsHost: card => card.parentElement,
        isPromoted: card => card.matches('[class*="vip" i], [class*="premium" i], [class*="featured" i]')
            || !!card.querySelector('[class*="vip" i], [class*="premium" i], [class*="featured" i]')
            || /\b(?:vip|premium|reklamuojama)\b/i.test(card.innerText),
        getNextPage: () => Array.from(document.querySelectorAll('a.pagination_link[href]'))
            .find(link => link.rel === 'next' || /^(?:»|›|next|kitas)$/i.test(link.innerText.trim()))?.href || '',
        getPriceFields: form => ({
            minimum: form.elements.namedItem('cost_min'),
            maximum: form.elements.namedItem('cost_max')
        }),
        detailHiddenSelectors: ['#header', '#recommendations-container', 'footer', '.other-info-content'],
        detailViewportWidth: 1300
    }];

    const portal = portals.find(candidate => candidate.matches());
    if (!portal) return;

    function cleanStrings(value) {
        return Array.isArray(value)
            ? [...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))]
            : [];
    }

    function normalizeSettings(candidate) {
        const source = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate : {};
        const knownSettings = Object.fromEntries(Object.entries(source)
            .filter(([key]) => Object.prototype.hasOwnProperty.call(DEFAULTS, key)));
        const normalizedSettings = { ...DEFAULTS, ...knownSettings };
        if (!Object.values(FILTERS).includes(normalizedSettings.activeFilter)) {
            normalizedSettings.activeFilter = FILTERS.SHOW_ALL;
        }
        for (const key of ['onlyUnviewed', 'onlyUnhidden', 'onlyUnapplied']) {
            normalizedSettings[key] = normalizedSettings[key] === true;
        }
        for (const key of [
            'blockedPhrases', 'blockedEmployers', 'blockedPositions',
            'viewedItems', 'hiddenJobs', 'appliedJobs'
        ]) {
            normalizedSettings[key] = cleanStrings(normalizedSettings[key]);
        }
        normalizedSettings.blockedEmployerPositions = Array.isArray(normalizedSettings.blockedEmployerPositions)
            ? normalizedSettings.blockedEmployerPositions.filter(item => item
                && typeof item.company === 'string' && item.company.trim()
                && typeof item.position === 'string' && item.position.trim())
                .map(item => ({ company: item.company.trim(), position: item.position.trim() }))
            : [];
        for (const key of ['minimumPrice', 'maximumPrice']) {
            const number = Number(normalizedSettings[key]);
            normalizedSettings[key] = Number.isFinite(number) ? Math.max(0, number) : 0;
        }
        normalizedSettings.splitViewWidths = Object.fromEntries(portals.map(item => {
            const width = Number(normalizedSettings.splitViewWidths?.[item.id]?.mainWidth) || 55;
            return [item.id, { mainWidth: Math.min(70, Math.max(30, width)) }];
        }));
        return normalizedSettings;
    }

    let settings = normalizeSettings(DEFAULTS);
    let selectedUrl = '';
    let processTimer;
    let paginationTimer;
    let previewRequest = 0;
    let pageContent;
    let host;
    let ui;
    let toolsPanel;
    let editorColumn;
    let filterButtons = new Map();
    let filterToggleButtons = new Map();
    let listEditors = new Map();
    let editorSections = new Map();
    let editorButtons = new Map();
    let minimumPriceInput;
    let maximumPriceInput;
    let resultsShareInput;
    let resultsShareLabel;
    let preview;
    let previewTitle;
    let previewContent;
    let previewFrame;
    let previewCloseButton;
    let previewResizeObserver;
    let status;
    let cardMenuId = 0;

    function normalized(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function includesText(text, value) {
        return normalized(text).includes(normalized(value));
    }

    function itemKey(href) {
        const url = new URL(href, location.href);
        url.hash = '';
        url.search = '';
        return `${url.origin}${url.pathname}`;
    }

    function parseAmount(raw) {
        let value = String(raw).replace(/[\s\u00a0]/g, '');
        const comma = value.lastIndexOf(',');
        const dot = value.lastIndexOf('.');
        if (comma >= 0 && dot >= 0) {
            value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
        } else if (comma >= 0) {
            const decimals = value.length - comma - 1;
            value = decimals === 3 ? value.replace(/,/g, '') : value.replace(',', '.');
        } else if (dot >= 0 && value.length - dot - 1 === 3) {
            value = value.replace(/\./g, '');
        }
        const price = Number(value);
        return Number.isFinite(price) ? price : null;
    }

    function parsePrice(text) {
        const match = String(text).match(/(?:^|\s)(\d[\d\s\u00a0.,]*)\s*€(?!\s*\/\s*m(?:²|2))/);
        return match ? parseAmount(match[1]) : null;
    }

    function announce(message) {
        if (status) {
            status.hidden = false;
            status.textContent = message;
        }
    }

    async function persistSettings(nextSettings = settings) {
        try {
            await GM_setValue(STORAGE_KEY, JSON.stringify(nextSettings));
            return true;
        } catch (error) {
            console.error('Classifieds Toolkit: could not save settings.', error);
            announce('Could not save settings. Check userscript storage and try again.');
            return false;
        }
    }

    function loadPaginationState(base) {
        try {
            const state = JSON.parse(sessionStorage.getItem(PAGINATION_KEY) || 'null');
            return state?.base === base && Array.isArray(state.visited) ? state : { base, visited: [] };
        } catch (error) {
            console.error('Classifieds Toolkit: could not read pagination state.', error);
            return { base, visited: [] };
        }
    }

    function paginationBase() {
        const url = new URL(location.href);
        url.pathname = url.pathname.replace(/\/\d+\/?$/, '/');
        url.hash = '';
        return url.href;
    }

    function clearPaginationState() {
        try {
            sessionStorage.removeItem(PAGINATION_KEY);
        } catch (error) {
            console.error('Classifieds Toolkit: could not clear pagination state.', error);
        }
    }

    function getCards() {
        return portal.getCards();
    }

    function selectedCard() {
        return getCards().find(card => itemKey(portal.getUrl(card)) === selectedUrl);
    }

    function setSplitViewWidths(resultsShare) {
        const availableWidth = document.documentElement.clientWidth;
        const resultsWidth = Math.round(availableWidth * resultsShare / 100);
        document.documentElement.style.setProperty('--ct-results-width', `${resultsWidth}px`);
        document.documentElement.style.setProperty('--ct-details-width', `${availableWidth - resultsWidth}px`);
    }

    function updateLayout() {
        const active = window.matchMedia(`(min-width: ${SPLIT_VIEW_MIN_WIDTH}px)`).matches
            && !!pageContent;
        document.body.classList.toggle('ct-split-view', active);
        if (!pageContent) return;
        setSplitViewWidths(settings.splitViewWidths[portal.id].mainWidth);
        if (preview) preview.hidden = !active || !selectedUrl;
    }

    function updateHistory(href) {
        const url = new URL(location.href);
        const hash = new URLSearchParams(url.hash.slice(1));
        if (href) hash.set('ct-ad', href);
        else hash.delete('ct-ad');
        url.hash = hash.toString();
        history.pushState({ classifiedsAd: href }, '', url);
    }

    function updateSelectedCards() {
        getCards().forEach(card => {
            card.classList.toggle('ct-selected', !!selectedUrl && itemKey(portal.getUrl(card)) === selectedUrl);
        });
    }

    function sizePreviewFrame() {
        if (!previewFrame) return;
        const width = previewContent.clientWidth;
        const height = previewContent.clientHeight;
        if (!width || !height) return;
        // Skelbiu redirects narrow embedded pages to m.skelbiu.lt, which cannot be framed here.
        const frameWidth = Math.max(width, portal.detailViewportWidth);
        const scale = Math.min(1, width / frameWidth);
        previewFrame.style.width = `${frameWidth}px`;
        previewFrame.style.height = `${height / scale}px`;
        previewFrame.style.zoom = String(scale);
    }

    function hideDetailPageChrome(doc) {
        const header = doc.querySelector('#header');
        if (!doc.head || !header) throw new Error('The original ad page header was not found.');
        let style = doc.getElementById('ct-detail-header-style');
        if (!style) {
            style = doc.createElement('style');
            style.id = 'ct-detail-header-style';
            doc.head.appendChild(style);
        }
        style.textContent = `${portal.detailHiddenSelectors.join(', ')} { display: none !important; }`;
    }

    function showPreviewFallback(message, href) {
        previewFrame = null;
        previewTitle.textContent = 'Could not load ad details';
        const explanation = document.createElement('p');
        explanation.textContent = message;
        const fallback = document.createElement('a');
        fallback.href = href;
        fallback.target = '_blank';
        fallback.rel = 'noopener noreferrer';
        fallback.textContent = 'Open ad in a new tab';
        previewContent.replaceChildren(explanation, fallback);
        announce(`${message} Open it in a new tab instead.`);
    }

    async function openPreview(href, updateUrl = true, moveFocus = false) {
        let url;
        try {
            url = new URL(href, location.href);
        } catch (error) {
            console.warn('Classifieds Toolkit: could not open this ad URL.', error);
            announce('Could not open this ad because its URL is invalid.');
            return;
        }
        if (url.origin !== location.origin || !/^\/skelbimai\/[^/]+-\d+\.html$/i.test(url.pathname)) {
            announce('This ad is outside the supported Skelbiu listings.');
            return;
        }
        selectedUrl = itemKey(url.href);
        preview.hidden = false;
        if (moveFocus) previewCloseButton.focus();
        preview.setAttribute('aria-busy', 'true');
        const selected = selectedCard();
        previewTitle.textContent = (selected && portal.getTitle(selected)) || 'Ad details';
        previewContent.replaceChildren();
        previewFrame = null;
        updateSelectedCards();

        const request = ++previewRequest;
        const key = selectedUrl;
        let viewedSaved = true;
        if (!settings.viewedItems.includes(key)) {
            const nextSettings = {
                ...settings,
                viewedItems: [...settings.viewedItems, key]
            };
            viewedSaved = await persistSettings(nextSettings);
            if (viewedSaved) {
                settings = nextSettings;
                applyFilters();
            }
        }
        if (request !== previewRequest) return;
        if (updateUrl) updateHistory(url.href);
        const card = selectedCard();
        previewTitle.textContent = (card && portal.getTitle(card)) || 'Ad details';
        const frame = document.createElement('iframe');
        frame.className = 'ct-detail-frame';
        frame.title = `Original ad page: ${previewTitle.textContent}`;
        frame.addEventListener('load', () => {
            if (request !== previewRequest || selectedUrl !== key) return;
            try {
                const doc = frame.contentDocument;
                if (!doc) throw new Error('The original ad page redirected outside Skelbiu.');
                hideDetailPageChrome(doc);
                announce(viewedSaved
                    ? 'Original ad page loaded.'
                    : 'Original ad page loaded, but its viewed status could not be saved.');
            } catch (error) {
                if (request !== previewRequest) return;
                console.error('Classifieds Toolkit: could not display the original ad page.', error);
                showPreviewFallback('Could not display the original ad page in the details panel.', url.href);
            } finally {
                if (request === previewRequest) preview.removeAttribute('aria-busy');
            }
        });
        previewFrame = frame;
        frame.src = url.href;
        previewContent.replaceChildren(frame);
        sizePreviewFrame();
    }

    function closePreview(updateUrl = true) {
        const previous = selectedCard();
        selectedUrl = '';
        previewRequest++;
        if (preview) {
            preview.hidden = true;
            preview.removeAttribute('aria-busy');
        }
        previewFrame = null;
        previewContent?.replaceChildren();
        updateSelectedCards();
        if (updateUrl) updateHistory('');
        previous?.focus();
    }

    function syncPreviewWithLocation() {
        const href = new URLSearchParams(location.hash.slice(1)).get('ct-ad');
        if (!href) {
            closePreview(false);
            return;
        }
        const card = getCards().find(item => itemKey(portal.getUrl(item)) === itemKey(href));
        if (card) openPreview(href, false, true);
        else closePreview(false);
    }

    function matchesBlockedRules(card, title, seller) {
        const text = portal.getListingText(card);
        return settings.blockedPhrases.some(value => includesText(text, value))
            || settings.blockedPositions.some(value => includesText(title, value) || includesText(text, value))
            || settings.blockedEmployers.some(value => (seller && normalized(seller) === normalized(value))
                || includesText(text, value))
            || settings.blockedEmployerPositions.some(pair => (
                (seller && normalized(seller) === normalized(pair.company))
                || includesText(text, pair.company)
            ) && (normalized(title) === normalized(pair.position) || includesText(text, pair.position)));
    }

    function saveStatus(key, list, checked, card) {
        const previousSettings = settings;
        const values = new Set(settings[list]);
        if (checked) values.add(key);
        else values.delete(key);
        const nextSettings = { ...settings, [list]: [...values] };
        persistSettings(nextSettings).then(saved => {
            if (saved) {
                settings = nextSettings;
                announce('Ad status saved.');
                applyFilters();
                focusAfterFiltering(card);
            } else {
                settings = previousSettings;
                applyFilters();
            }
        });
    }

    async function addBlockedValue(list, value, card) {
        const cleaned = value.trim();
        if (!cleaned) {
            announce('Enter a value to block.');
            return false;
        }
        if (settings[list].some(item => normalized(item) === normalized(cleaned))) {
            announce('That value is already blocked.');
            return false;
        }
        const nextSettings = normalizeSettings({ ...settings, [list]: [...settings[list], cleaned] });
        if (!await persistSettings(nextSettings)) return false;
        settings = nextSettings;
        renderBlockedLists();
        applyFilters();
        focusAfterFiltering(card);
        announce('Block added.');
        return true;
    }

    async function addBlock(card, kind) {
        const company = portal.getSeller(card);
        const position = portal.getTitle(card);
        const nextSettings = { ...settings };
        if (kind === 'seller' && company
            && !settings.blockedEmployers.some(item => normalized(item) === normalized(company))) {
            nextSettings.blockedEmployers = [...settings.blockedEmployers, company];
        } else if (kind === 'pair' && company && position
            && !settings.blockedEmployerPositions.some(item =>
                normalized(item.company) === normalized(company) && normalized(item.position) === normalized(position))) {
            nextSettings.blockedEmployerPositions = [
                ...settings.blockedEmployerPositions, { company, position }
            ];
        } else if (kind === 'title' && position
            && !settings.blockedPositions.some(item => normalized(item) === normalized(position))) {
            nextSettings.blockedPositions = [...settings.blockedPositions, position];
        } else {
            announce('Could not add that block: listing details are missing or already blocked.');
            return;
        }
        const normalizedSettings = normalizeSettings(nextSettings);
        if (!await persistSettings(normalizedSettings)) return;
        settings = normalizedSettings;
        renderBlockedLists();
        applyFilters();
        focusAfterFiltering(card);
        announce('Block added.');
    }

    function openBlockValueDialog(value, kind, card, returnFocus) {
        const isPhrase = kind === 'phrase';
        const list = isPhrase ? 'blockedPhrases' : 'blockedPositions';
        const title = document.createElement('h2');
        title.id = 'ct-block-title';
        title.textContent = isPhrase ? 'Block phrase' : 'Block title';
        const blockDialog = document.createElement('dialog');
        blockDialog.id = 'ct-block-dialog';
        blockDialog.setAttribute('aria-labelledby', title.id);
        const form = document.createElement('form');
        const label = document.createElement('label');
        label.htmlFor = 'ct-block-value';
        label.textContent = isPhrase ? 'Phrase to block (required)' : 'Title to block (required)';
        const input = document.createElement('input');
        input.id = label.htmlFor;
        input.type = 'text';
        input.required = true;
        input.value = value;
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => blockDialog.close());
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Save block';
        const actions = document.createElement('div');
        actions.className = 'ct-dialog-actions';
        actions.append(cancel, submit);
        form.append(label, input, actions);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (await addBlockedValue(list, input.value, card)) blockDialog.close();
            else input.focus();
        });
        blockDialog.append(title, form);
        blockDialog.addEventListener('close', () => {
            blockDialog.remove();
            if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus();
            else focusAfterFiltering(card);
        }, { once: true });
        host.shadowRoot.appendChild(blockDialog);
        blockDialog.showModal();
        input.focus();
    }

    function addBlockActions(menu, card, closeMenu) {
        const group = document.createElement('div');
        group.className = 'ct-card-menu-group';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'Ad blocking actions');
        for (const [label, kind] of [
            ['Block seller', 'seller'],
            ['Block seller + title', 'pair'],
            ['Block title', 'title']
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => {
                addBlock(card, kind);
                closeMenu();
            });
            group.appendChild(button);
        }
        const phraseButton = document.createElement('button');
        phraseButton.type = 'button';
        phraseButton.textContent = 'Block phrase…';
        phraseButton.addEventListener('click', () => {
            closeMenu();
            openBlockValueDialog(
                portal.getTitle(card),
                'phrase',
                card,
                portal.getCardToolsHost(card)?.querySelector('.ct-card-trigger')
            );
        });
        group.appendChild(phraseButton);
        menu.appendChild(group);
    }

    function ensureCardTools(card) {
        const row = portal.getCardToolsHost(card);
        if (!row || row.querySelector(':scope > .ct-card-actions')) return;
        row.classList.add('ct-card-container');
        const key = itemKey(portal.getUrl(card));
        const actions = document.createElement('div');
        actions.className = 'ct-card-actions';
        actions.dataset.ctUi = '';

        const contactedInput = document.createElement('input');
        contactedInput.type = 'checkbox';
        contactedInput.className = 'ct-applied-checkbox';
        contactedInput.dataset.ctUi = '';
        contactedInput.dataset.status = 'appliedJobs';
        contactedInput.checked = settings.appliedJobs.includes(key);
        contactedInput.setAttribute('aria-label', `Mark ${portal.getTitle(card) || 'listing'} as contacted`);
        contactedInput.title = 'Mark as contacted';
        contactedInput.addEventListener('click', event => event.stopPropagation());
        contactedInput.addEventListener('change', () => saveStatus(key, 'appliedJobs', contactedInput.checked, card));
        actions.appendChild(contactedInput);

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'checkbox';
        hiddenInput.className = 'ct-hidden-checkbox';
        hiddenInput.dataset.ctUi = '';
        hiddenInput.dataset.status = 'hiddenJobs';
        hiddenInput.checked = settings.hiddenJobs.includes(key);
        hiddenInput.setAttribute('aria-label', `Mark ${portal.getTitle(card) || 'listing'} as hidden`);
        hiddenInput.title = 'Mark as hidden';
        hiddenInput.addEventListener('click', event => event.stopPropagation());
        hiddenInput.addEventListener('change', () => saveStatus(key, 'hiddenJobs', hiddenInput.checked, card));
        actions.appendChild(hiddenInput);

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'ct-card-trigger';
        trigger.textContent = '...';
        trigger.dataset.ctUi = '';
        trigger.setAttribute('aria-label', `Ad tools for ${portal.getTitle(card) || 'listing'}`);
        trigger.setAttribute('aria-expanded', 'false');
        actions.appendChild(trigger);

        const menu = document.createElement('div');
        menu.id = `ct-card-menu-${++cardMenuId}`;
        menu.className = 'ct-card-menu';
        menu.hidden = true;
        menu.dataset.ctUi = '';
        addBlockActions(menu, card, () => {
            menu.hidden = true;
            row.classList.remove('ct-card-open');
            trigger.setAttribute('aria-expanded', 'false');
        });
        trigger.setAttribute('aria-controls', menu.id);
        trigger.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            document.querySelectorAll('.ct-card-menu:not([hidden])').forEach(openMenu => {
                openMenu.hidden = true;
                openMenu.parentElement.querySelector('.ct-card-trigger')?.setAttribute('aria-expanded', 'false');
                openMenu.parentElement.parentElement.classList.remove('ct-card-open');
            });
            menu.hidden = false;
            row.classList.add('ct-card-open');
            trigger.setAttribute('aria-expanded', 'true');
            menu.querySelector('button')?.focus();
        });
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                menu.hidden = true;
                row.classList.remove('ct-card-open');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            }
        });
        actions.appendChild(menu);
        row.appendChild(actions);
    }

    function installPageStyles() {
        if (document.getElementById('ct-page-style')) return;
        const style = document.createElement('style');
        style.id = 'ct-page-style';
        style.textContent = `
            body.ct-split-view #ct-page-content {
                display: block !important;
                box-sizing: border-box !important;
                width: min(var(--ct-results-width, 50vw), calc(100vw - var(--ct-details-width, 45vw))) !important;
                max-width: min(var(--ct-results-width, 50vw), calc(100vw - var(--ct-details-width, 45vw))) !important;
                min-width: 0 !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                overflow-x: auto !important;
            }
            .ct-filtered-out { display: none !important; }
            .display--flex{justify-content: center !important; }
            .ct-card-container { position: relative !important; overflow: visible !important; }
            .ct-card-actions { position: absolute !important; top: 4px !important; right: 4px !important; z-index: 9999 !important; display: flex; align-items: center; gap: 4px; overflow: visible !important; }
            .ct-applied-checkbox, .ct-hidden-checkbox { appearance: none !important; display: grid; place-items: center; box-sizing: border-box; width: 32px; height: 32px; margin: 0; border: 0 !important; background: transparent !important; cursor: pointer; }
            .ct-applied-checkbox::after { content: '✅'; font-size: 20px; filter: grayscale(1); }
            .ct-applied-checkbox:checked::after { filter: grayscale(0); }
            .ct-hidden-checkbox { position: relative; }
            .ct-hidden-checkbox::before { content: '👁️'; filter: grayscale(1); font-size: 20px; }
            .ct-hidden-checkbox:checked::after { position: absolute; content: '/'; color: #767676; font-size: 25px; font-weight: 700; line-height: 1; transform: rotate(15deg); }
            .ct-applied-checkbox:focus-visible, .ct-hidden-checkbox:focus-visible, .ct-card-trigger:focus-visible, .ct-card-menu button:focus-visible { outline: 3px solid #075a9c; outline-offset: 2px; }
            .ct-card-trigger { min-width: 32px; min-height: 32px; padding: 4px 8px; border: 1px solid #767676; border-radius: 4px; background: #fff; color: #202124; line-height: 1; }
            .ct-card-open { position: relative !important; z-index: 100000 !important; }
            .ct-card-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 100002; width: 240px; padding: 8px; border: 1px solid #767676; border-radius: 6px; background: #fff; color: #202124; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
            .ct-card-menu[hidden] { display: none !important; }
            .ct-card-menu-group { display: grid; gap: 6px; }
            .ct-card-menu button { min-height: 32px; border: 1px solid #767676; border-radius: 4px; background: #fff; color: #202124; padding: 4px 8px; text-align: left; }
            .ct-selected { outline: 3px solid #075a9c !important; outline-offset: -3px !important; }
            @media (forced-colors: active) {
                .ct-card-actions button, .ct-card-menu { border-color: ButtonBorder !important; background: Canvas !important; color: CanvasText !important; box-shadow: none; }
                .ct-applied-checkbox, .ct-hidden-checkbox { appearance: none !important; background: transparent !important; }
                .ct-applied-checkbox::after, .ct-hidden-checkbox::before { filter: grayscale(1); }
                .ct-hidden-checkbox:checked::after { color: GrayText; }
                .ct-selected { outline-color: Highlight !important; }
            }
        `;
        document.head.appendChild(style);
    }

    function makeUi() {
        pageContent = document.createElement('div');
        pageContent.id = 'ct-page-content';
        while (document.body.firstChild) pageContent.appendChild(document.body.firstChild);
        document.body.appendChild(pageContent);

        host = document.createElement('div');
        host.id = 'ct-ui';
        document.documentElement.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            :host { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; color: #202124; font: 14px/1.45 Arial, sans-serif; }
            * { box-sizing: border-box; }
            button, input, select, textarea { font: inherit; }
            button, summary, input[type="checkbox"], input[type="range"] { cursor: pointer; }
            button, select, input, textarea { color: #202124; }
            button { min-height: 36px; border: 1px solid #767676; border-radius: 4px; background: #fff; padding: 6px 10px; }
            button:hover { background: #f2f2f2; }
            :focus-visible { outline: 3px solid #075a9c !important; outline-offset: 2px; }
            #ct-open { position: fixed; z-index: 2; left: 16px; top: 10px; pointer-events: auto; border: 1px solid #444; background: #fff; }
            #ct-tools-panel { position: fixed; top: 52px; left: 16px; display: flex; gap: 10px; width: max-content; max-width: calc(100vw - 32px); max-height: min(1000px,calc(100vh - 68px)); overflow: hidden; align-items: stretch; padding: 12px; border: 1px solid #767676; border-radius: 8px; background: #fff; color: #202124; box-shadow: 0 2px 8px rgb(0 0 0 / 20%); pointer-events: auto; }
            #ct-tools-panel[hidden], .ct-tools-column[hidden], .ct-tools-section[hidden] { display: none !important; }
            .ct-tools-column { display: flex; flex-direction: column; gap: 8px; min-width: 215px; min-height: 0; overflow-y: auto; }
            #ct-tools-editor { flex: 0 1 500px; width: 500px; max-width: min(500px,calc(100vw - 290px)); }
            .ct-tools-section { display: flex; flex-direction: column; gap: 5px; }
            .ct-tools-heading { margin: 0; font-size: 15px; }
            .ct-tools-button { border-color: #075a9c; background: #075a9c; color: #fff; text-align: left; }
            .ct-tools-secondary { background: #fff; color: #202124; text-align: left; }
            .ct-tools-list { display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow: auto; }
            .ct-tools-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; padding: 6px; border: 1px solid #b7b7b7; border-radius: 4px; }
            .ct-tools-input-field { display: flex; flex: 1 1 140px; flex-direction: column; gap: 3px; min-width: 0; }
            .ct-tools-input-field span { font-size: 12px; }
            .ct-tools-input-field input { width: 100%; min-width: 0; padding: 7px; }
            .ct-tools-row-actions { display: flex; flex: 0 0 auto; gap: 4px; }
            .ct-tools-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
            .ct-tools-form input { flex: 1 1 180px; width: 0; min-width: 0; padding: 7px; }
            .ct-tools-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            .ct-tools-field input { width: 100%; min-width: 0; padding: 5px; }
            .ct-tools-range { width: 100%; }
            .ct-tools-filter[aria-pressed="true"] { border-color: #075a9c; background: #075a9c; color: #fff; }
            #ct-panel { position: fixed; inset: 0 0 0 auto; display: grid; grid-template-rows: auto minmax(0,1fr); width: min(var(--ct-details-width,45vw),100vw); height: 100vh; height: 100dvh; border-left: 1px solid #767676; background: #fff; pointer-events: auto; }
            #ct-panel[hidden] { display: none; }
            #ct-head { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px 14px; border-bottom: 1px solid #767676; }
            #ct-title { flex: 1; min-width: 0; margin: 0; font-size: 18px; overflow-wrap: anywhere; }
            #ct-content { min-height: 0; min-width: 0; overflow: hidden; padding: 0; }
            .ct-detail-frame { display: block; border: 0; }
            #ct-status { min-height: 1em; }
            #ct-json-dialog { width: min(42rem,calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 16px; border: 1px solid #767676; border-radius: 8px; background: #fff; color: #202124; }
            #ct-json-dialog::backdrop { background: rgb(0 0 0 / 35%); }
            #ct-json-dialog h2 { margin: 0 0 12px; font-size: 1.2rem; }
            #ct-json-dialog textarea { display: block; box-sizing: border-box; width: 100%; min-height: 16rem; max-height: 55vh; resize: vertical; padding: 8px; border: 1px solid #5f6368; border-radius: 4px; background: #fff; color: #202124; font: 13px monospace; overflow-wrap: anywhere; }
            #ct-json-dialog button { min-height: 40px; padding: 6px 10px; border: 1px solid #5f6368; border-radius: 4px; background: #fff; color: #202124; }
            #ct-json-dialog button:focus-visible, #ct-json-dialog textarea:focus-visible { outline: 3px solid #075a9c; outline-offset: 2px; }
            #ct-json-dialog [data-settings-actions] { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
            #ct-block-dialog { width: min(28rem,calc(100vw - 32px)); padding: 16px; border: 1px solid #767676; border-radius: 8px; background: #fff; color: #202124; }
            #ct-block-dialog::backdrop { background: rgb(0 0 0 / 35%); }
            #ct-block-dialog input { display: block; box-sizing: border-box; width: 100%; min-height: 40px; margin-top: 8px; padding: 8px; border: 1px solid #5f6368; border-radius: 4px; background: #fff; }
            #ct-block-dialog form > div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
            .ct-tools-row button:focus-visible, #ct-tools-panel button:focus-visible, #ct-open:focus-visible { outline: 3px solid #111; outline-offset: 2px; }
            .ct-tools-column > .ct-tools-section > button { width: 100%; }
            .ct-tools-status { flex: 0 0 auto; }
            @media (forced-colors: active) {
                button, #ct-tools-panel, #ct-panel, #ct-json-dialog, #ct-block-dialog { border-color: ButtonBorder; color: CanvasText; background: Canvas; }
                a { color: LinkText; }
                .ct-selected { outline-color: Highlight !important; }
                .ct-tools-filter[aria-pressed="true"] { outline: 2px solid Highlight; outline-offset: 1px; }
                #ct-block-dialog input { border-color: ButtonBorder; color: CanvasText; background: Canvas; }
            }
        `;
        ui = document.createElement('div');
        ui.dataset.ctUi = '';
        const open = document.createElement('button');
        open.id = 'ct-open';
        open.type = 'button';
        open.textContent = 'Classifieds tools';
        open.setAttribute('aria-expanded', 'false');
        open.setAttribute('aria-controls', 'ct-tools-panel');
        toolsPanel = document.createElement('section');
        toolsPanel.id = 'ct-tools-panel';
        toolsPanel.hidden = true;
        toolsPanel.setAttribute('aria-label', 'Classifieds tools');
        editorColumn = document.createElement('div');
        editorColumn.id = 'ct-tools-editor';
        editorColumn.className = 'ct-tools-column';
        editorColumn.hidden = true;
        const toolsColumn = document.createElement('div');
        toolsColumn.className = 'ct-tools-column';
        toolsPanel.append(editorColumn, toolsColumn);
        status = document.createElement('div');
        status.id = 'ct-status';
        status.className = 'ct-tools-status';
        status.hidden = true;
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        open.addEventListener('click', () => {
            toolsPanel.hidden = !toolsPanel.hidden;
            open.setAttribute('aria-expanded', String(!toolsPanel.hidden));
            if (toolsPanel.hidden) open.focus();
        });

        preview = document.createElement('aside');
        preview.id = 'ct-panel';
        preview.hidden = true;
        preview.setAttribute('aria-label', 'Selected ad details');
        const header = document.createElement('div');
        header.id = 'ct-head';
        previewTitle = document.createElement('h2');
        previewTitle.id = 'ct-title';
        previewCloseButton = document.createElement('button');
        previewCloseButton.type = 'button';
        previewCloseButton.textContent = 'Close';
        previewCloseButton.addEventListener('click', () => closePreview());
        header.append(previewTitle, previewCloseButton);
        previewContent = document.createElement('div');
        previewContent.id = 'ct-content';
        preview.append(header, previewContent);
        previewResizeObserver = new ResizeObserver(sizePreviewFrame);
        previewResizeObserver.observe(previewContent);

        ui.append(open, toolsPanel, preview);
        shadow.append(style, ui);
        buildToolsPanel(toolsColumn);
        toolsColumn.appendChild(status);
        renderBlockedLists();
        refreshToolControls();
    }

    function makeToolsButton(label, handler, className = 'ct-tools-button') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.className = className;
        button.addEventListener('click', () => handler(button));
        return button;
    }

    function toolsHeading(text) {
        const element = document.createElement('h2');
        element.className = 'ct-tools-heading';
        element.textContent = text;
        return element;
    }

    function createToolField(label) {
        const field = document.createElement('label');
        field.className = 'ct-tools-input-field';
        const caption = document.createElement('span');
        caption.textContent = label;
        const input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('aria-label', label);
        field.append(caption, input);
        return { field, input };
    }

    function createAddForm(fields, buttonText, submit) {
        const form = document.createElement('form');
        form.className = 'ct-tools-form';
        const controls = fields.map(label => createToolField(label));
        const inputs = controls.map(control => control.input);
        const button = document.createElement('button');
        button.type = 'submit';
        button.className = 'ct-tools-button';
        button.textContent = buttonText;
        form.append(...controls.map(control => control.field), button);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (await submit(inputs.map(input => input.value))) {
                form.reset();
                if (inputs[0].isConnected) inputs[0].focus();
            }
        });
        return form;
    }

    function createEditableRow(list, labels, values, onSave, onRemove) {
        const row = document.createElement('div');
        row.className = 'ct-tools-row';
        const controls = labels.map((label, index) => {
            const control = createToolField(label);
            const input = control.input;
            input.value = values[index];
            row.appendChild(control.field);
            return control;
        });
        const inputs = controls.map(control => control.input);
        let savedValues = inputs.map(input => input.value);
        let saving;
        let removed = false;
        async function saveRow() {
            if (removed) return;
            const valuesNow = inputs.map(input => input.value);
            if (valuesNow.every((value, index) => value === savedValues[index])) return;
            if (saving) await saving;
            if (removed || valuesNow.every((value, index) => value === savedValues[index])) return;
            saving = onSave(valuesNow);
            if (await saving) savedValues = valuesNow;
            saving = undefined;
        }
        const actions = document.createElement('div');
        actions.className = 'ct-tools-row-actions';
        const saveButton = makeToolsButton('Save', saveRow, 'ct-tools-secondary');
        const removeButton = makeToolsButton('Remove', async () => {
            if (saving) await saving;
            removed = true;
            if (!await onRemove()) removed = false;
        }, 'ct-tools-secondary');
        actions.append(saveButton, removeButton);
        row.appendChild(actions);
        row.addEventListener('focusout', event => {
            if (row.isConnected && !row.dataset.discarded && !row.contains(event.relatedTarget)) saveRow();
        });
        list.appendChild(row);
    }

    function buildToolsPanel(toolsColumn) {
        const phraseSection = document.createElement('section');
        phraseSection.className = 'ct-tools-section';
        phraseSection.hidden = true;
        phraseSection.appendChild(toolsHeading('Blocked phrases'));
        const sellerSection = document.createElement('section');
        sellerSection.className = 'ct-tools-section';
        sellerSection.hidden = true;
        sellerSection.appendChild(toolsHeading('Blocked sellers'));
        const titleSection = document.createElement('section');
        titleSection.className = 'ct-tools-section';
        titleSection.hidden = true;
        titleSection.appendChild(toolsHeading('Blocked titles'));
        editorColumn.append(phraseSection, sellerSection, titleSection);
        editorSections = new Map([
            ['phrases', phraseSection],
            ['sellers', sellerSection],
            ['titles', titleSection]
        ]);
        function addListEditor(section, key, heading, labels) {
            if (heading) section.appendChild(toolsHeading(heading));
            const list = document.createElement('div');
            list.className = 'ct-tools-list';
            listEditors.set(key, { list, labels });
            section.append(createAddForm(labels, 'Add to list', values => addListEntry(key, values)), list);
        }
        addListEditor(phraseSection, 'blockedPhrases', '', ['Blocked phrase']);
        addListEditor(sellerSection, 'blockedEmployers', '', ['Blocked seller']);
        addListEditor(sellerSection, 'blockedEmployerPositions', 'Seller + title', ['Seller', 'Title']);
        addListEditor(titleSection, 'blockedPositions', '', ['Blocked title']);

        const filterSection = document.createElement('section');
        filterSection.className = 'ct-tools-section';
        filterSection.appendChild(toolsHeading('Classifieds filters'));
        [
            [FILTERS.SHOW_ALL, 'Show all ads'],
            [FILTERS.SHOW_PROMOTED, 'Promoted only'],
            [FILTERS.SHOW_NORMAL, 'Normal ads only']
        ].forEach(([value, label]) => {
            const button = makeToolsButton(label, async () => {
                const nextSettings = { ...settings, activeFilter: value };
                if (!await persistSettings(nextSettings)) return;
                settings = nextSettings;
                hideEditor();
                refreshToolControls();
                applyFilters();
                announce('Listing filter applied.');
            });
            button.classList.add('ct-tools-filter');
            button.setAttribute('aria-pressed', String(settings.activeFilter === value));
            filterButtons.set(value, button);
            filterSection.appendChild(button);
        });
        for (const [key, label] of [
            ['onlyUnviewed', 'Only unviewed'],
            ['onlyUnhidden', 'Hide hidden'],
            ['onlyUnapplied', 'Hide contacted']
        ]) {
            const button = makeToolsButton(`${label}: ${settings[key] ? 'On' : 'Off'}`, async () => {
                const nextSettings = { ...settings, [key]: !settings[key] };
                if (!await persistSettings(nextSettings)) return;
                settings = nextSettings;
                hideEditor();
                refreshToolControls();
                applyFilters();
            }, 'ct-tools-secondary');
            filterToggleButtons.set(key, { label, button });
            filterSection.appendChild(button);
        }
        const priceSection = document.createElement('section');
        priceSection.className = 'ct-tools-section';
        priceSection.appendChild(toolsHeading('Price filter (EUR)'));
        const minimumLabel = document.createElement('label');
        minimumLabel.className = 'ct-tools-field';
        minimumLabel.append('Minimum price');
        minimumPriceInput = document.createElement('input');
        minimumPriceInput.type = 'number';
        minimumPriceInput.min = '0';
        minimumPriceInput.step = 'any';
        minimumLabel.appendChild(minimumPriceInput);
        const maximumLabel = document.createElement('label');
        maximumLabel.className = 'ct-tools-field';
        maximumLabel.append('Maximum price');
        maximumPriceInput = document.createElement('input');
        maximumPriceInput.type = 'number';
        maximumPriceInput.min = '0';
        maximumPriceInput.step = 'any';
        maximumLabel.appendChild(maximumPriceInput);
        minimumPriceInput.addEventListener('change', savePriceRange);
        maximumPriceInput.addEventListener('change', savePriceRange);
        priceSection.append(minimumLabel, maximumLabel);

        const layoutSection = document.createElement('section');
        layoutSection.className = 'ct-tools-section';
        layoutSection.appendChild(toolsHeading('Page layout'));
        const layoutLabel = document.createElement('label');
        layoutLabel.className = 'ct-tools-field';
        resultsShareLabel = document.createElement('span');
        resultsShareInput = document.createElement('input');
        resultsShareInput.className = 'ct-tools-range';
        resultsShareInput.type = 'range';
        resultsShareInput.min = '30';
        resultsShareInput.max = '70';
        resultsShareInput.setAttribute('aria-label', 'Results pane share');
        resultsShareInput.addEventListener('input', () => {
            resultsShareLabel.textContent = `Results pane share: ${resultsShareInput.value}%`;
            resultsShareInput.setAttribute('aria-valuetext', `${resultsShareInput.value}% for results`);
            setSplitViewWidths(Number(resultsShareInput.value));
        });
        resultsShareInput.addEventListener('change', saveLayoutWidth);
        layoutLabel.append(resultsShareLabel, resultsShareInput);
        layoutSection.appendChild(layoutLabel);

        const listNavigation = document.createElement('section');
        listNavigation.className = 'ct-tools-section';
        listNavigation.appendChild(toolsHeading('Lists'));
        for (const [label, name] of [
            ['Blocked phrases', 'phrases'],
            ['Blocked sellers', 'sellers'],
            ['Blocked titles', 'titles']
        ]) {
            const button = makeToolsButton(label, () => openEditor(name), 'ct-tools-secondary');
            button.setAttribute('aria-controls', editorColumn.id);
            button.setAttribute('aria-expanded', 'false');
            editorButtons.set(name, button);
            listNavigation.appendChild(button);
        }
        const importExport = makeToolsButton('Import/export', openSettingsDialog, 'ct-tools-secondary');
        listNavigation.appendChild(importExport);
        toolsColumn.append(filterSection, priceSection, layoutSection, listNavigation);
    }

    function openEditor(name) {
        if (toolsPanel.hidden) {
            toolsPanel.hidden = false;
            host.shadowRoot.getElementById('ct-open').setAttribute('aria-expanded', 'true');
        }
        editorSections.forEach(section => { section.hidden = true; });
        editorColumn.hidden = false;
        const section = editorSections.get(name);
        section.hidden = false;
        editorButtons.forEach((button, editorName) => {
            button.setAttribute('aria-expanded', String(editorName === name));
        });
        section.querySelector('input')?.focus();
    }

    function hideEditor() {
        editorColumn.hidden = true;
        editorSections.forEach(section => { section.hidden = true; });
        editorButtons.forEach(button => button.setAttribute('aria-expanded', 'false'));
    }

    function refreshToolControls() {
        filterButtons.forEach((button, value) => {
            button.setAttribute('aria-pressed', String(settings.activeFilter === value));
        });
        filterToggleButtons.forEach(({ label, button }, key) => {
            button.textContent = `${label}: ${settings[key] ? 'On' : 'Off'}`;
        });
        if (minimumPriceInput) minimumPriceInput.value = settings.minimumPrice || '';
        if (maximumPriceInput) maximumPriceInput.value = settings.maximumPrice || '';
        if (resultsShareInput) {
            const share = settings.splitViewWidths[portal.id].mainWidth;
            resultsShareInput.value = String(share);
            resultsShareLabel.textContent = `Results pane share: ${share}%`;
            resultsShareInput.setAttribute('aria-valuetext', `${share}% for results`);
        }
    }

    async function savePriceRange() {
        if (!minimumPriceInput.checkValidity() || !maximumPriceInput.checkValidity()) {
            announce('Enter a non-negative price amount.');
            (minimumPriceInput.validity.valid ? maximumPriceInput : minimumPriceInput).reportValidity();
            return;
        }
        const minimumPrice = Number(minimumPriceInput.value) || 0;
        const maximumPrice = Number(maximumPriceInput.value) || 0;
        if (minimumPrice && maximumPrice && minimumPrice > maximumPrice) {
            announce('Minimum price cannot be greater than maximum price.');
            minimumPriceInput.focus();
            refreshToolControls();
            return;
        }
        const nextSettings = normalizeSettings({ ...settings, minimumPrice, maximumPrice });
        if (!await persistSettings(nextSettings)) {
            refreshToolControls();
            return;
        }
        settings = nextSettings;
        applyNativePriceFilters();
        applyFilters();
        announce('Price filter saved.');
    }

    async function saveLayoutWidth() {
        const splitViewWidths = {
            ...settings.splitViewWidths,
            [portal.id]: { mainWidth: Number(resultsShareInput.value) }
        };
        const nextSettings = normalizeSettings({ ...settings, splitViewWidths });
        if (!await persistSettings(nextSettings)) {
            refreshToolControls();
            updateLayout();
            return;
        }
        settings = nextSettings;
        updateLayout();
        announce('Page layout saved.');
    }

    function listValues(key, item) {
        return key === 'blockedEmployerPositions' ? [item.company, item.position] : [item];
    }

    function makeListEntry(key, values) {
        return key === 'blockedEmployerPositions'
            ? { company: values[0].trim(), position: values[1].trim() }
            : values[0].trim();
    }

    function sameListEntry(key, first, second) {
        return key === 'blockedEmployerPositions'
            ? normalized(first.company) === normalized(second.company)
                && normalized(first.position) === normalized(second.position)
            : normalized(first) === normalized(second);
    }

    async function addListEntry(key, values) {
        if (values.some(value => !value.trim())) {
            announce('Enter a value for every field.');
            return false;
        }
        const entry = makeListEntry(key, values);
        if (settings[key].some(item => sameListEntry(key, item, entry))) {
            announce('That item is already in the list.');
            return false;
        }
        const nextSettings = normalizeSettings({ ...settings, [key]: [...settings[key], entry] });
        if (!await persistSettings(nextSettings)) return false;
        settings = nextSettings;
        renderBlockedLists();
        applyFilters();
        announce('List item added.');
        return true;
    }

    async function updateListEntry(key, index, values) {
        if (values.some(value => !value.trim())) {
            announce('Enter a value for every field.');
            return false;
        }
        const entry = makeListEntry(key, values);
        if (settings[key].some((item, itemIndex) => itemIndex !== index && sameListEntry(key, item, entry))) {
            announce('That item is already in the list.');
            return false;
        }
        const items = [...settings[key]];
        items[index] = entry;
        const nextSettings = normalizeSettings({ ...settings, [key]: items });
        if (!await persistSettings(nextSettings)) return false;
        settings = nextSettings;
        applyFilters();
        announce('List item updated.');
        return true;
    }

    async function removeListEntry(key, index) {
        const items = settings[key].filter((_, itemIndex) => itemIndex !== index);
        const nextSettings = normalizeSettings({ ...settings, [key]: items });
        if (!await persistSettings(nextSettings)) return false;
        settings = nextSettings;
        renderBlockedLists();
        applyFilters();
        announce('List item removed.');
        const section = key === 'blockedPhrases' ? editorSections.get('phrases')
            : key === 'blockedPositions' ? editorSections.get('titles') : editorSections.get('sellers');
        section.querySelector('form input')?.focus();
        return true;
    }

    function renderBlockedLists() {
        listEditors.forEach(({ list, labels }, key) => {
            list.querySelectorAll('.ct-tools-row').forEach(row => { row.dataset.discarded = 'true'; });
            list.replaceChildren();
            settings[key].forEach((item, index) => {
                createEditableRow(
                    list,
                    labels,
                    listValues(key, item),
                    values => updateListEntry(key, index, values),
                    () => removeListEntry(key, index)
                );
            });
        });
    }

    function openSettingsDialog(trigger) {
        const jsonDialog = document.createElement('dialog');
        jsonDialog.id = 'ct-json-dialog';
        jsonDialog.setAttribute('aria-labelledby', 'ct-json-title');
        const title = document.createElement('h2');
        title.id = 'ct-json-title';
        title.textContent = 'Import/export settings';
        const modeButtons = document.createElement('div');
        modeButtons.setAttribute('data-settings-actions', '');
        const importMode = document.createElement('button');
        importMode.type = 'button';
        importMode.textContent = 'Import';
        const exportMode = document.createElement('button');
        exportMode.type = 'button';
        exportMode.textContent = 'Export';
        modeButtons.append(importMode, exportMode);
        const fieldLabel = document.createElement('label');
        fieldLabel.htmlFor = 'ct-settings-json';
        const field = document.createElement('textarea');
        field.id = fieldLabel.htmlFor;
        field.spellcheck = false;
        const message = document.createElement('div');
        message.setAttribute('role', 'status');
        message.setAttribute('aria-live', 'polite');
        const actions = document.createElement('div');
        actions.setAttribute('data-settings-actions', '');
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', () => jsonDialog.close());
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Import';
        actions.append(close, submit);
        const form = document.createElement('form');
        form.append(fieldLabel, field, message, actions);
        jsonDialog.append(title, modeButtons, form);

        function setMode(mode) {
            const exporting = mode === 'export';
            fieldLabel.textContent = exporting ? 'Settings JSON (click to select and copy)' : 'Settings JSON to import';
            field.placeholder = exporting ? '' : 'Paste settings JSON here';
            field.readOnly = exporting;
            field.value = exporting ? JSON.stringify(settings, null, 2) : '';
            submit.hidden = exporting;
            message.textContent = '';
            if (exporting) {
                field.focus();
                field.select();
                if (navigator.clipboard?.writeText) {
                    const exportedSettings = field.value;
                    navigator.clipboard.writeText(exportedSettings).then(
                        () => {
                            if (jsonDialog.open && field.readOnly && field.value === exportedSettings) {
                                message.textContent = 'Settings JSON copied to clipboard.';
                            }
                        },
                        error => {
                            console.warn('Classifieds Toolkit: could not copy exported settings.', error);
                            if (jsonDialog.open && field.readOnly && field.value === exportedSettings) {
                                message.textContent = 'JSON selected, but clipboard access failed. Copy it manually.';
                            }
                        }
                    );
                } else {
                    message.textContent = 'JSON selected. Clipboard access is unavailable; copy it manually.';
                }
            } else {
                field.focus();
            }
        }

        importMode.addEventListener('click', () => setMode('import'));
        exportMode.addEventListener('click', () => setMode('export'));
        field.addEventListener('click', () => {
            if (field.readOnly) setMode('export');
        });
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (field.value.length > 5_000_000) {
                message.textContent = 'Settings JSON is too large to import.';
                field.focus();
                return;
            }
            let imported;
            try {
                imported = JSON.parse(field.value);
            } catch (error) {
                message.textContent = `Invalid JSON: ${error.message}`;
                field.focus();
                return;
            }
            if (!imported || typeof imported !== 'object' || Array.isArray(imported)) {
                message.textContent = 'Settings JSON must be an object.';
                field.focus();
                return;
            }
            const nextSettings = normalizeSettings(imported);
            if (nextSettings.minimumPrice && nextSettings.maximumPrice
                && nextSettings.minimumPrice > nextSettings.maximumPrice) {
                message.textContent = 'Minimum price cannot be greater than maximum price.';
                field.focus();
                return;
            }
            if (!await persistSettings(nextSettings)) {
                message.textContent = 'Could not save imported settings. Existing settings were kept.';
                return;
            }
            settings = nextSettings;
            renderBlockedLists();
            refreshToolControls();
            updateLayout();
            applyFilters();
            message.textContent = 'Settings imported and saved.';
        });
        jsonDialog.addEventListener('close', () => {
            jsonDialog.remove();
            trigger.focus();
        }, { once: true });
        host.shadowRoot.appendChild(jsonDialog);
        jsonDialog.showModal();
        setMode('import');
    }

    function applyNativePriceFilters() {
        const form = document.querySelector('#searchForm');
        if (!form) return;
        const fields = portal.getPriceFields(form);
        if (fields.minimum && settings.minimumPrice) {
            const current = parseAmount(fields.minimum.value) || 0;
            fields.minimum.value = String(Math.max(current || 0, settings.minimumPrice));
        }
        if (fields.maximum && settings.maximumPrice) {
            const current = parseAmount(fields.maximum.value) || 0;
            fields.maximum.value = String(current ? Math.min(current, settings.maximumPrice) : settings.maximumPrice);
        }
    }

    function schedulePagination(cards, visibleCount) {
        clearTimeout(paginationTimer);
        if (visibleCount > 0) {
            clearPaginationState();
            return;
        }
        if (!cards.length) return;
        paginationTimer = setTimeout(() => {
            const next = portal.getNextPage();
            if (!next) return;
            const base = paginationBase();
            const state = loadPaginationState(base);
            const current = location.href;
            if (state.visited.includes(current) || state.visited.length >= 100) {
                announce('No unvisited results pages remain.');
                clearPaginationState();
                return;
            }
            state.visited.push(current);
            try {
                sessionStorage.setItem(PAGINATION_KEY, JSON.stringify(state));
                location.href = next;
            } catch (error) {
                console.error('Classifieds Toolkit: could not save pagination progress.', error);
                announce('Could not continue to the next page because session storage failed.');
            }
        }, 500);
    }

    function applyFilters() {
        const cards = getCards();
        let visibleCount = 0;
        cards.forEach(card => {
            ensureCardTools(card);
            const href = portal.getUrl(card);
            const key = itemKey(href);
            const controls = portal.getCardToolsHost(card)?.querySelector(':scope > .ct-card-actions');
            const contactedInput = controls?.querySelector('input[data-status="appliedJobs"]');
            const hiddenInput = controls?.querySelector('input[data-status="hiddenJobs"]');
            if (contactedInput) contactedInput.checked = settings.appliedJobs.includes(key);
            if (hiddenInput) hiddenInput.checked = settings.hiddenJobs.includes(key);
            const title = portal.getTitle(card);
            const seller = portal.getSeller(card);
            const price = parsePrice(portal.getPriceText(card));
            const promoted = portal.isPromoted(card);
            let visible = !matchesBlockedRules(card, title, seller);
            if (price !== null && settings.minimumPrice && price < settings.minimumPrice) visible = false;
            if (price !== null && settings.maximumPrice && price > settings.maximumPrice) visible = false;
            if (settings.onlyUnviewed && settings.viewedItems.includes(key)
                && key !== selectedUrl) visible = false;
            if (settings.onlyUnhidden && settings.hiddenJobs.includes(key)) visible = false;
            if (settings.onlyUnapplied && settings.appliedJobs.includes(key)) visible = false;
            if (settings.activeFilter === FILTERS.SHOW_PROMOTED && !promoted) visible = false;
            if (settings.activeFilter === FILTERS.SHOW_NORMAL && promoted) visible = false;
            card.classList.toggle('ct-filtered-out', !visible);
            if (visible) card.style.removeProperty('display');
            else card.style.setProperty('display', 'none', 'important');
            if (controls) controls.hidden = !visible;
            if (visible) visibleCount++;
        });
        updateSelectedCards();
        schedulePagination(cards, visibleCount);
        if (selectedUrl && !cards.some(card => itemKey(portal.getUrl(card)) === selectedUrl)) {
            closePreview();
        } else if (selectedUrl) {
            const card = selectedCard();
            if (card?.classList.contains('ct-filtered-out')) {
                const next = cards.find(item => !item.classList.contains('ct-filtered-out'));
                if (next) openPreview(portal.getUrl(next));
            }
        }
    }

    function focusAfterFiltering(card) {
        if (!card || getComputedStyle(card).display !== 'none') return;
        const next = getCards().find(item => getComputedStyle(item).display !== 'none');
        const target = next && portal.getCardToolsHost(next)?.querySelector('.ct-card-trigger');
        if (target) target.focus();
        else if (next) next.focus();
        else host?.shadowRoot?.getElementById('ct-open')?.focus();
    }

    function processPage() {
        const cards = getCards();
        if (cards.length) {
            applyNativePriceFilters();
        }
        updateLayout();
        applyFilters();
    }

    function scheduleProcess() {
        clearTimeout(processTimer);
        processTimer = setTimeout(processPage, 120);
    }

    async function initialize() {
        let loadFailed = false;
        try {
            const stored = await GM_getValue(STORAGE_KEY, JSON.stringify(DEFAULTS));
            settings = normalizeSettings(typeof stored === 'string' ? JSON.parse(stored) : stored);
        } catch (error) {
            console.error('Classifieds Toolkit: could not load settings.', error);
            loadFailed = true;
        }
        installPageStyles();
        makeUi();
        if (loadFailed) announce('Could not load saved settings; defaults are active for this page.');
        updateLayout();
        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target || target.closest('[data-ct-ui]') || !window.matchMedia(
                `(min-width: ${SPLIT_VIEW_MIN_WIDTH}px)`
            ).matches) return;
            const card = getCards().find(item => item === target || item.contains(target));
            if (!card || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
                || card.target === '_blank') return;
            event.preventDefault();
            openPreview(portal.getUrl(card), true, event.detail === 0);
        }, true);
        document.addEventListener('click', event => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            document.querySelectorAll('.ct-card-menu:not([hidden])').forEach(menu => {
                if (menu.contains(target) || menu.parentElement.querySelector('.ct-card-trigger')?.contains(target)) return;
                menu.hidden = true;
                menu.parentElement.querySelector('.ct-card-trigger')?.setAttribute('aria-expanded', 'false');
                menu.parentElement.parentElement.classList.remove('ct-card-open');
            });
        }, true);
        document.addEventListener('submit', event => {
            if (event.target instanceof HTMLFormElement && event.target.id === 'searchForm') {
                applyNativePriceFilters();
            }
        }, true);
        window.addEventListener('resize', updateLayout);
        window.addEventListener('popstate', syncPreviewWithLocation);
        window.addEventListener('hashchange', syncPreviewWithLocation);
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && selectedUrl
                && !host.shadowRoot.querySelector('dialog[open]')) closePreview();
        });
        new MutationObserver(records => {
            if (records.some(record => [...record.addedNodes].some(node =>
                node instanceof Element && !node.closest('[data-ct-ui]')
            ))) scheduleProcess();
        }).observe(document.body, { childList: true, subtree: true });
        processPage();
        syncPreviewWithLocation();
    }

    await initialize();
})();
