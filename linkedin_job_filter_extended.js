// ==UserScript==
// @name         Job Search Toolkit
// @namespace    http://tampermonkey.net/
// @version      6.24
// @description  Filter job listings, block matches, and highlight skills and salaries
// @author       yange.xyz + matty
// @match        https://www.linkedin.com/jobs/*
// @match        https://www.cvbankas.lt/*
// @match        https://www.cvonline.lt/*
// @match        https://www.cvmarket.lt/*
// @match        https://www.cv.lt/*
// @match        https://pinokis.com/*
// @match        https://jobs.workinlithuania.com/*
// @match        https://uzt.lt/app/laisvos-darbo-vietos*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(async function () {
    'use strict';
    if (window.top !== window.self) return;

    const STORAGE_KEY = 'linkedinJobFilterSettings';
    const CV_DATABASE = 'jobSearchToolkitPreferredCV';
    const CV_STORE = 'files';
    const CV_RECORD = 'pinokis';
    const MAX_CV_SIZE = 30 * 1024 * 1024;
    const FILTERS = { SHOW_ALL: 'SHOW_ALL', SHOW_PROMOTED: 'SHOW_PROMOTED', SHOW_NORMAL: 'SHOW_NORMAL' };
    const SALARY_FILTER_TOLERANCE = 0.1;
    const splitViewSites = new Set(['cvbankas', 'cvonline', 'cvmarket', 'cvlt', 'pinokis', 'uzt']);
    const AUTO_PAGINATION_KEY = 'liJobToolsEmptyResultsPagination';
    const PINOKIS_APPLIED_CONFIRMATION = 'CV sėkmingai įkeltas. Palinkėsim kantrybės laukiant skambučio! Per tą laiką paskaityk ką apie įmonę parašė kiti.';
    const defaults = {
        activeFilter: FILTERS.SHOW_ALL,
        onlyUnviewed: false,
        onlyUnhidden: false,
        onlyUnapplied: false,
        blockedPhrases: [],
        blockedEmployers: [],
        blockedEmployerPositions: [],
        blockedPositions: [],
        appliedJobs: [],
        hiddenJobs: [],
        skillsEnabled: true,
        skills: [],
        skillCategories: [],
        salaryMinimum: 0,
        mainWidth: 100,
        detailsWidth: 65,
        splitViewWidths: Object.fromEntries([...splitViewSites].map(site => [
            site, { mainWidth: 55 }
        ]))
    };
    let settings = { ...defaults };
    let openMenuCard = null;
    let cardMenuId = 0;
    let processTimer;
    const expandedMoreButtons = new WeakSet();
    const attemptedCVInputs = new WeakSet();
    const pinokisAppliedConfirmationDocuments = new WeakSet();
    const pinokisAppliedConfirmationObservers = new WeakSet();
    let cvDatabasePromise;
    let preferredCVHandle;
    let preferredCVLoaded = false;
    let cvFillInProgress = false;

    const skillGroups = {
        strong: { label: 'Core languages', skills: ['Go', 'Golang', 'Java', 'Python', 'C++', 'C#', 'Rust', 'Kotlin', 'Scala', 'Ruby', 'Swift', 'Erlang', 'Elixir', 'Haskell', 'PHP', 'Objective-C'] },
        intermediate: { label: 'Frameworks and APIs', skills: ['Spring', 'Spring Boot', 'Spring MVC', 'Spring Cloud', 'Django', 'Django REST Framework', 'Flask', 'Express', 'NestJS', 'Koa', 'ASP.NET', 'ASP.NET Core', 'Blazor', 'React', 'React Native', 'Vue.js', 'Nuxt.js', 'Svelte', 'Angular', 'Ember.js', 'Backbone.js', 'Meteor', 'Ruby on Rails', 'Laravel', 'GraphQL', 'REST', 'gRPC', 'WebSockets', 'Next.js', 'Gatsby'] },
        technologies: { label: 'Technologies', skills: ['.NET', 'MS SQL', 'Axapta', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'Terraform', 'Ansible', 'Jenkins', 'Git', 'GitHub Actions'] },
        leadership: { label: 'Leadership', skills: ['Team Leadership', 'Stakeholder Management', 'Process Definition', 'Strategy Development', 'Roadmapping', 'Budget Management', 'KPI Tracking', 'Change Management', 'Outsourced Management', 'Software Development Oversight', 'Cross-functional Alignment'] },
        behaviors: { label: 'Behaviors', skills: ['Problem Solving', 'Decision Making', 'Priority Management', 'Attention to Detail', 'Innovation', 'Adaptability', 'Mentoring', 'Team Collaboration', 'Cross-functional Communication', 'Conflict Resolution', 'Emotional Intelligence'] },
        itManagement: { label: 'IT management', skills: ['ITIL', 'ITSM', 'COBIT', 'ISO 20000', 'ISO 27001', 'ServiceNow', 'BMC Remedy', 'Cherwell', 'Jira Service Desk', 'ITOM', 'SRE Practices', 'Azure DevOps', 'AWS CloudFormation', 'Puppet', 'Chef', 'Nagios', 'Splunk'] },
        governance: { label: 'Governance', skills: ['PMP', 'PRINCE2', 'Six Sigma', 'Lean IT', 'CMMI', 'TOGAF', 'Enterprise Architecture', 'Risk Management', 'SOX Compliance', 'GDPR', 'HIPAA', 'Business Continuity Planning', 'Vendor Management', 'Audit Management', 'Agile Ceremonies', 'Kanban', 'SAFe', 'Jira', 'Confluence', 'Agile'] },
        compensation: { label: 'Compensation', skills: ['Salary', 'Wage', 'Compensation', 'Remuneration', 'Pay', 'Base Salary', 'Bonus', 'Equity', 'Stock Options', 'Benefits', 'Overtime', 'Incentives'] }
    };
    const skillGroupColors = {
        strong: '#d8f3d4',
        intermediate: '#fff2b3',
        technologies: '#d7efff',
        leadership: '#e1e9ff',
        behaviors: '#ffe3dc',
        itManagement: '#e5e2ff',
        governance: '#ffe8cc',
        compensation: '#fce1f2'
    };
    const defaultSkillCategories = [
        ...Object.entries(skillGroups).map(([id, group]) => ({ id, label: group.label })),
        { id: 'custom', label: 'Other' }
    ];
    const defaultSkills = Object.entries(skillGroups).flatMap(([group, data]) =>
        data.skills.map(name => ({ name, color: skillGroupColors[group], group }))
    );
    defaults.skills = defaultSkills;
    defaults.skillCategories = defaultSkillCategories;
    settings.skills = defaultSkills.map(skill => ({ ...skill }));
    settings.skillCategories = defaultSkillCategories.map(category => ({ ...category }));
    const defaultSkillCategoryByName = new Map(defaultSkills.map(skill => [skill.name.toLowerCase(), skill.group]));
    const skillSignature = new WeakMap();
    const salarySignature = new WeakMap();

    async function saveSettings() {
        try {
            await GM_setValue(STORAGE_KEY, JSON.stringify(settings));
            return true;
        } catch (error) {
            console.error('Job Search Toolkit: could not save settings.', error);
            return false;
        }
    }

    function normalizeSettings(candidate) {
        const knownSettings = Object.fromEntries(Object.entries(candidate)
            .filter(([key]) => Object.prototype.hasOwnProperty.call(defaults, key)));
        settings = { ...defaults, ...knownSettings };
        if (!Object.values(FILTERS).includes(settings.activeFilter)) settings.activeFilter = FILTERS.SHOW_ALL;
        for (const key of ['onlyUnviewed', 'onlyUnhidden', 'onlyUnapplied']) {
            settings[key] = settings[key] === true;
        }
        for (const key of ['blockedPhrases', 'blockedEmployers', 'blockedEmployerPositions', 'blockedPositions', 'appliedJobs', 'hiddenJobs']) {
            if (!Array.isArray(settings[key])) settings[key] = [];
        }
        for (const key of ['blockedPhrases', 'blockedEmployers', 'blockedPositions', 'appliedJobs', 'hiddenJobs']) {
            settings[key] = settings[key].filter(item => typeof item === 'string' && item.trim());
        }
        settings.blockedEmployerPositions = settings.blockedEmployerPositions.filter(item =>
            item && typeof item.company === 'string' && item.company.trim()
            && typeof item.position === 'string' && item.position.trim()
        );
        settings.skillsEnabled = settings.skillsEnabled !== false;
        const categories = Array.isArray(settings.skillCategories) ? settings.skillCategories : defaultSkillCategories;
        const seenCategories = new Set();
        settings.skillCategories = categories.filter(category =>
            category && typeof category.id === 'string' && /^[\w-]+$/.test(category.id)
            && typeof category.label === 'string' && category.label.trim()
            && !seenCategories.has(category.id)
            && seenCategories.add(category.id)
        ).map(category => ({ id: category.id, label: category.label.trim() }));
        if (!settings.skillCategories.some(category => category.id === 'custom')) {
            settings.skillCategories.push({ id: 'custom', label: 'Other' });
        }
        const skills = Array.isArray(settings.skills) ? settings.skills : defaultSkills;
        const seenSkills = new Set();
        settings.skills = skills.filter(skill =>
            skill && typeof skill.name === 'string' && skill.name.trim()
            && typeof skill.color === 'string' && /^#[\da-f]{6}$/i.test(skill.color)
            && !seenSkills.has(skill.name.trim().toLowerCase())
            && seenSkills.add(skill.name.trim().toLowerCase())
        ).map(skill => ({
            name: skill.name.trim(),
            color: skill.color,
            group: settings.skillCategories.some(category => category.id === skill.group)
                ? skill.group
                : defaultSkillCategoryByName.get(skill.name.trim().toLowerCase()) || 'custom'
        }));
        const salaryMinimum = Number(settings.salaryMinimum);
        settings.salaryMinimum = Number.isFinite(salaryMinimum) ? Math.max(0, salaryMinimum) : 0;
        settings.mainWidth = Math.min(140, Math.max(70, Number(settings.mainWidth) || 100));
        settings.detailsWidth = Math.min(85, Math.max(50, Number(settings.detailsWidth) || 65));
        settings.splitViewWidths = Object.fromEntries([...splitViewSites].map(site => {
            const widths = settings.splitViewWidths?.[site] || {};
            const oldDetailsWidth = Number(widths.detailsWidth);
            const resultsShare = Number(widths.mainWidth) || 55;
            const split = Number.isFinite(oldDetailsWidth) && oldDetailsWidth > 0
                ? Math.round(resultsShare / (resultsShare + oldDetailsWidth) * 100)
                : resultsShare;
            return [site, {
                mainWidth: Math.min(70, Math.max(30, split))
            }];
        }));
        return settings;
    }

    async function loadSettings() {
        let savedSettings = {};
        try {
            const stored = await GM_getValue(STORAGE_KEY, null);
            if (stored) {
                const saved = typeof stored === 'string' ? JSON.parse(stored) : stored;
                if (saved && typeof saved === 'object' && !Array.isArray(saved)) savedSettings = saved;
            }
        } catch (error) {
            console.error('Job Search Toolkit: could not load settings; using defaults.', error);
        }
        normalizeSettings(savedSettings);
    }

    await loadSettings();

    function openCVDatabase() {
        if (!cvDatabasePromise) {
            cvDatabasePromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(CV_DATABASE, 1);
                request.onupgradeneeded = () => {
                    if (!request.result.objectStoreNames.contains(CV_STORE)) {
                        request.result.createObjectStore(CV_STORE);
                    }
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    cvDatabasePromise = null;
                    reject(request.error || new Error('Could not open preferred CV storage.'));
                };
            });
        }
        return cvDatabasePromise;
    }

    async function getPreferredCVHandle() {
        if (preferredCVLoaded) return preferredCVHandle;
        const database = await openCVDatabase();
        preferredCVHandle = await new Promise((resolve, reject) => {
            const request = database.transaction(CV_STORE).objectStore(CV_STORE).get(CV_RECORD);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Could not read the preferred CV.'));
        });
        preferredCVLoaded = true;
        return preferredCVHandle;
    }

    async function savePreferredCVHandle(handle) {
        const database = await openCVDatabase();
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(CV_STORE, 'readwrite');
            transaction.objectStore(CV_STORE).put(handle, CV_RECORD);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('Could not save the preferred CV.'));
            transaction.onabort = () => reject(transaction.error || new Error('Could not save the preferred CV.'));
        });
        preferredCVHandle = handle;
        preferredCVLoaded = true;
    }

    async function removePreferredCVHandle() {
        const database = await openCVDatabase();
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(CV_STORE, 'readwrite');
            transaction.objectStore(CV_STORE).delete(CV_RECORD);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('Could not remove the preferred CV.'));
            transaction.onabort = () => reject(transaction.error || new Error('Could not remove the preferred CV.'));
        });
        preferredCVHandle = null;
        preferredCVLoaded = true;
    }

    function isSupportedCV(file) {
        return file && /\.(pdf|docx?)$/i.test(file.name)
            && file.size > 0 && file.size <= MAX_CV_SIZE;
    }

    function pinokisCVInput(doc = document) {
        return doc.querySelector('form#cv-upload-form input[type="file"][accept*=".pdf"]');
    }

    function showCVPermissionButton(input) {
        const form = input.closest('form');
        if (!form || form.querySelector('[data-li-job-tools-cv-access]')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.liJobToolsCvAccess = '';
        button.className = 'w-full h-12 rounded-xl border border-slate-200 text-slate-700 font-semibold';
        button.textContent = 'Allow access and attach preferred CV';
        button.addEventListener('click', async () => {
            try {
                await fillPinokisCV(input, true);
            } catch (error) {
                console.error('Job Search Toolkit: could not access the preferred CV.', error);
                setStatus('Could not access the preferred CV. Check browser permission.');
            }
        });
        input.addEventListener('change', () => button.remove(), { once: true });
        input.closest('label')?.after(button);
    }

    async function fillPinokisCV(input, requestPermission, report = setStatus) {
        if (!input?.isConnected || input.files.length) return false;
        const handle = await getPreferredCVHandle();
        if (!handle) return false;
        let permission = await handle.queryPermission({ mode: 'read' });
        if (permission !== 'granted' && requestPermission) {
            permission = await handle.requestPermission({ mode: 'read' });
        }
        if (permission !== 'granted') {
            if (!requestPermission) showCVPermissionButton(input);
            report('Allow access to the saved CV in Import/export settings, then attach it here.');
            return false;
        }
        const file = await handle.getFile();
        if (!isSupportedCV(file)) {
            report('The preferred CV must be a non-empty PDF, DOC, or DOCX file no larger than 30 MB.');
            return false;
        }
        if (!input.isConnected || input.files.length) return false;
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.closest('form')?.querySelector('[data-li-job-tools-cv-access]')?.remove();
        report('Preferred CV attached. Review it before submitting.');
        return true;
    }

    async function schedulePreferredCVFill(doc = document) {
        if (getSite() !== 'pinokis' || cvFillInProgress) return;
        const input = pinokisCVInput(doc);
        if (!input || input.files.length || attemptedCVInputs.has(input)) return;
        attemptedCVInputs.add(input);
        cvFillInProgress = true;
        try {
            await fillPinokisCV(input, false);
        } catch (error) {
            console.error('Job Search Toolkit: could not preselect the preferred CV.', error);
            setStatus('Could not access the preferred CV. Check browser permission and settings.');
        } finally {
            cvFillInProgress = false;
        }
    }

    const panel = document.createElement('section');
    panel.id = 'li-job-tools-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Job search tools');
    Object.assign(panel.style, {
        position: 'fixed', top: '52px', left: '16px', zIndex: '9999',
        display: 'flex', gap: '10px', maxWidth: 'calc(100vw - 32px)',
        height: 'calc(100vh - 68px)',         maxHeight: 'min(1000px, calc(100vh - 68px))', overflow: 'hidden',
        alignItems: 'stretch',
        padding: '12px', border: '1px solid #767676', borderRadius: '8px',
        background: '#fff', color: '#202124', boxShadow: '0 2px 8px rgba(0,0,0,.2)',
        font: '14px Arial,sans-serif'
    });
    document.body.appendChild(panel);

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.id = 'li-job-tools-toggle';
    toggleButton.textContent = 'Job tools';
    toggleButton.setAttribute('aria-label', 'Toggle job search tools');
    toggleButton.setAttribute('aria-controls', panel.id);
    toggleButton.setAttribute('aria-expanded', 'false');
    Object.assign(toggleButton.style, {
        position: 'fixed', top: '10px', left: '16px', zIndex: '10003',
        padding: '7px 10px', border: '1px solid #767676', borderRadius: '6px',
        background: '#fff', color: '#202124', cursor: 'pointer'
    });
    toggleButton.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        toggleButton.setAttribute('aria-expanded', String(!panel.hidden));
        if (panel.hidden) toggleButton.focus();
    });
    document.body.appendChild(toggleButton);

    const style = document.createElement('style');
    style.textContent = `
        #li-job-tools-panel { box-sizing: border-box; width: max-content; z-index: 10002 !important; }
        #li-job-tools-panel[hidden] { display: none !important; }
        #li-job-tools-panel * { box-sizing: border-box; }
        #li-job-tools-panel button, #li-job-tools-panel input { font: inherit; }
        #li-job-tools-panel button { cursor: pointer; }
        #li-job-tools-panel button:focus-visible, #li-job-tools-toggle:focus-visible,
        .li-tools-menu button:focus-visible { outline: 3px solid #111; outline-offset: 2px; }
        .li-tools-column { display: flex; flex-direction: column; gap: 8px; min-width: 215px; min-height: 0; overflow-y: auto; }
        #li-tools-editor { flex: 0 1 500px; width: 500px; max-width: 100%; }
        .li-tools-column[hidden], .li-tools-section[hidden] { display: none !important; }
        .li-tools-section { display: flex; flex-direction: column; gap: 5px; }
        #li-tools-editor > .li-tools-section:not([hidden]) { flex: 1 1 auto; min-height: 0; overflow: hidden; }
        .li-tools-heading { margin: 0; font-size: 15px; }
        .li-tools-button { padding: 7px; border: 1px solid #075a9c; border-radius: 4px; background: #075a9c; color: #fff; text-align: left; }
        .li-tools-secondary { padding: 6px; border: 1px solid #767676; border-radius: 4px; background: #fff; color: #202124; }
        .li-tools-row { display: flex; align-items: center; flex-wrap: nowrap; gap: 6px; padding: 6px; border: 1px solid #b7b7b7; border-radius: 4px; min-width: 0; }
        .li-tools-row input[type=text] { flex: 1 1 0; width: 0; min-width: 0; padding: 7px; }
        .li-tools-row input[type=color], .li-tools-form input[type=color] { flex: 0 0 42px; width: 42px; height: 34px; padding: 2px; }
        .li-tools-row-actions { display: flex; flex: 0 0 auto; gap: 4px; }
        .li-tools-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 5px; }
        .li-tools-icon-button svg { width: 20px; height: 20px; fill: currentColor; }
        .li-tools-form { display: flex; flex-direction: row; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
        .li-tools-form input[type=text] { flex: 1 1 180px; width: 0; min-width: 0; padding: 7px; }
        .li-tools-form button { flex: 0 0 auto; }
        .li-tools-list { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-height: 0; overflow: auto; }
        .li-tools-list button { flex: 0 0 auto; border: 0; background: transparent; color: #202124; }
        .li-tools-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .li-tools-field input { width: 100%; min-width: 0; }
        .li-tools-field input[type=number] { width: 100%; padding: 5px; }
        .li-tools-range { width: 100%; }
        .li-tools-skills { flex: 1 1 auto; min-height: 0; overflow: auto; }
        .li-tools-skill-group summary { padding: 4px 0; cursor: pointer; font-weight: 600; }
        .li-tools-skill { border-radius: 2px; padding: 0 2px; font-weight: 600; }
        .li-tools-salary-above { background: #d8f3d4 !important; color: #173d12 !important; text-decoration: underline !important; }
        .li-tools-salary-below { background: #ffe3dc !important; color: #5b2115 !important; text-decoration: underline wavy !important; }
        .li-tools-filtered-out { display: none !important; }
        .li-tools-menu { padding: 8px; border-top: 1px solid #b7b7b7; }
        .li-tools-menu button { display: block; width: 100%; margin-top: 4px; padding: 7px; border: 1px solid #767676; border-radius: 4px; background: #fff; color: #202124; text-align: left; }
        #li-tools-block-value-dialog { box-sizing: border-box; width: 28rem; max-width: calc(100vw - 2rem); padding: 16px; border: 1px solid #767676; border-radius: 8px; background: #fff; color: #202124; }
        #li-tools-block-value-dialog::backdrop { background: rgb(0 0 0 / 35%); }
        #li-tools-block-value-dialog h2 { margin: 0 0 12px; font-size: 1.2rem; }
        #li-tools-block-value-dialog label { display: block; margin-bottom: 4px; color: #202124 !important; }
        #li-tools-block-value-dialog input {
            box-sizing: border-box !important;
            width: 100% !important;
            min-width: 0 !important;
            min-height: 40px;
            padding: 8px !important;
            border: 1px solid #5f6368 !important;
            border-radius: 4px !important;
            background: #fff !important;
            color: #202124 !important;
            font: inherit !important;
        }
        #li-tools-block-value-dialog button { min-height: 40px; padding: 6px 10px; border: 1px solid #5f6368 !important; border-radius: 4px; background: #fff !important; color: #202124 !important; font: inherit; cursor: pointer; }
        #li-tools-block-value-dialog button:hover { background: #f0f0f0 !important; }
        #li-tools-block-value-dialog button:focus-visible, #li-tools-block-value-dialog input:focus-visible { outline: 3px solid #075a9c; outline-offset: 2px; }
        #li-tools-block-value-dialog form > div { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        #li-tools-settings-dialog { box-sizing: border-box; width: 42rem; max-width: calc(100vw - 2rem); max-height: calc(100vh - 2rem); overflow: auto; padding: 16px; border: 1px solid #767676; border-radius: 8px; background: #fff; color: #202124; }
        #li-tools-settings-dialog::backdrop { background: rgb(0 0 0 / 35%); }
        #li-tools-settings-dialog h2 { margin: 0 0 12px; font-size: 1.2rem; }
        #li-tools-settings-dialog textarea { display: block; box-sizing: border-box; width: 100%; min-height: 16rem; max-height: 55vh; resize: vertical; padding: 8px; border: 1px solid #5f6368; border-radius: 4px; background: #fff; color: #202124; font: 13px monospace; overflow-wrap: anywhere; }
        #li-tools-settings-dialog input { max-width: 100%; font: inherit; }
        #li-tools-settings-dialog input[type=file] { display: block; width: 100%; min-height: 40px; margin-top: 6px; }
        #li-tools-settings-dialog button { min-height: 40px; padding: 6px 10px; border: 1px solid #5f6368; border-radius: 4px; background: #fff; color: #202124; font: inherit; cursor: pointer; }
        #li-tools-settings-dialog button:hover { background: #f0f0f0; }
        #li-tools-settings-dialog button:focus-visible, #li-tools-settings-dialog input:focus-visible,
        #li-tools-settings-dialog textarea:focus-visible { outline: 3px solid #075a9c; outline-offset: 2px; }
        #li-tools-settings-dialog [data-settings-actions] { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
        @media (forced-colors: active) {
            #li-tools-block-value-dialog { border-color: CanvasText; background: Canvas; color: CanvasText; }
            #li-tools-block-value-dialog::backdrop { background: Canvas; }
            #li-tools-block-value-dialog label, #li-tools-block-value-dialog input,
            #li-tools-block-value-dialog button {
                border-color: ButtonBorder !important;
                background: Canvas !important;
                color: CanvasText !important;
            }
            #li-tools-block-value-dialog button:focus-visible,
            #li-tools-block-value-dialog input:focus-visible { outline-color: Highlight; }
            #li-tools-settings-dialog { border-color: CanvasText; background: Canvas; color: CanvasText; }
            #li-tools-settings-dialog::backdrop { background: Canvas; }
            #li-tools-settings-dialog button, #li-tools-settings-dialog input, #li-tools-settings-dialog textarea {
                border-color: ButtonBorder;
                background: Canvas;
                color: CanvasText;
            }
            #li-tools-settings-dialog button:focus-visible,
            #li-tools-settings-dialog input:focus-visible,
            #li-tools-settings-dialog textarea:focus-visible { outline-color: Highlight; }
        }
        .li-tools-card-actions { position: relative !important; z-index: 9999 !important; overflow: visible !important; }
        .li-tools-card-container { position: relative !important; overflow: visible !important; }
        .li-tools-card-actions-floating { position: absolute !important; top: 4px !important; right: 4px !important; display: flex; align-items: center; gap: 4px; }
        .li-tools-applied-checkbox {
            appearance: none !important;
            display: grid;
            place-items: center;
            box-sizing: border-box;
            width: 32px;
            height: 32px;
            margin: 0;
            border: 0 !important;
            background: transparent !important;
            cursor: pointer;
        }
        .li-tools-applied-checkbox::after {
            content: '✅';
            font-size: 20px;
            filter: grayscale(1);
        }
        .li-tools-applied-checkbox:checked::after { filter: grayscale(0); }
        .li-tools-applied-checkbox:focus-visible { outline: 3px solid #075a9c; outline-offset: 2px; }
        .li-tools-hidden-checkbox {
            appearance: none !important;
            position: relative;
            display: grid;
            place-items: center;
            box-sizing: border-box;
            width: 32px;
            height: 32px;
            margin: 0;
            border: 0 !important;
            background: transparent !important;
            cursor: pointer;
        }
        .li-tools-hidden-checkbox::before { content: '👁️'; filter: grayscale(1); font-size: 20px; }
        .li-tools-hidden-checkbox:checked::after {
            position: absolute;
            content: '/';
            color: #767676;
            font-size: 25px;
            font-weight: 700;
            line-height: 1;
            transform: rotate(15deg);
        }
        .li-tools-hidden-checkbox:focus-visible { outline: 3px solid #075a9c; outline-offset: 2px; }
        .li-tools-card-actions-floating > .li-tools-card-trigger { padding: 4px 8px; border: 1px solid #767676; border-radius: 4px; background: #fff; color: #202124; line-height: 1; }
        .li-tools-card-open { position: relative !important; z-index: 100000 !important; }
        .li-tools-card-trigger { min-width: 32px; min-height: 32px; }
        .li-tools-card-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 100002; width: 240px; padding: 8px; border: 1px solid #767676; border-radius: 6px; background: #fff; color: #202124; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
        .li-tools-card-menu[hidden] { display: none !important; }
        .li-tools-card-menu button:focus-visible { outline: 3px solid #111; outline-offset: 2px; }
        #li-tools-job-preview {
            box-sizing: border-box;
            display: none;
            position: fixed;
            inset: 0 0 auto auto;
            height: 100vh;
            height: 100dvh;
            z-index: 10001;
            grid-template-rows: auto minmax(0, 1fr);
            width: min(var(--li-tools-preview-width, 45vw), 100vw);
            border-left: 1px solid #767676;
            background: #fff;
            color: #202124;
        }
        #li-tools-job-preview[hidden] { display: none !important; }
        #li-tools-job-preview-header { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 10px 14px; border-bottom: 1px solid #b7b7b7; }
        #li-tools-job-preview-title { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; margin: 0; font-size: 16px; }
        .li-tools-title-pill, .li-tools-title-label { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 4px 8px; overflow-wrap: anywhere; border: 1px solid #767676; border-radius: 999px; background: #f5f5f5; color: #202124; font-size: 13px; font-weight: 500; user-select: text; -webkit-user-select: text; }
        .li-tools-title-pill { font: inherit; font-size: 13px; cursor: context-menu; }
        .li-tools-title-icon { flex: 0 0 16px; width: 16px; height: 16px; fill: currentColor; }
        .li-tools-title-pill:focus-visible { outline: 3px solid #111; outline-offset: 2px; }
        .li-tools-title-menu { position: fixed; z-index: 10010; min-width: 180px; padding: 6px; border: 1px solid #767676; border-radius: 6px; background: #fff; color: #202124; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
        .li-tools-title-menu button { display: block; width: 100%; padding: 7px; border: 0; background: #fff; color: #202124; text-align: left; cursor: pointer; }
        .li-tools-title-menu button:focus-visible { outline: 3px solid #111; outline-offset: -2px; }
        #li-tools-job-preview-close { flex: 0 0 auto; padding: 6px 10px; border: 1px solid #767676; border-radius: 4px; background: #fff; color: #202124; }
        #li-tools-job-preview-frame { width: 100%; height: 100%; border: 0; background: #fff; }
        .li-tools-job-selected { outline: 3px solid #075a9c !important; outline-offset: -3px !important; }
        @media (min-width: 1200px) {
            body.li-tools-split-view #li-tools-job-preview:not([hidden]) { display: grid; }
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper {
                display: flex !important;
                flex-direction: column !important;
                gap: 0 !important;
                width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                max-width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                margin: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper > #hero,
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper > #main_container {
                flex: 0 0 auto !important;
                width: 100% !important;
                max-width: none !important;
                margin: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper > #main_container { flex: 1 1 auto !important; min-width: 0 !important; }
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper > #sidebar,
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper > #main_aside,
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper > .hero_placeholder,
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #main_wrapper > .content_placeholder { display: none !important; }
            body.li-tools-split-view[data-li-tools-site="cvbankas"] #js_id_id_job_ad_list { width: 100% !important; }
            body.li-tools-split-view[data-li-tools-site="cvonline"] .search__container > .container {
                width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                max-width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                margin: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="cvonline"] .top-banner { display: none !important; }
            body.li-tools-split-view[data-li-tools-site="cvonline"] .search,
            body.li-tools-split-view[data-li-tools-site="cvonline"] .search__content { width: 100% !important; min-width: 0 !important; }
            body.li-tools-split-view[data-li-tools-site="cvonline"] .vacancies-list { width: 100% !important; min-width: 0 !important; }
            body.li-tools-split-view[data-li-tools-site="cvmarket"] section[class~="lg:container"] {
                width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                max-width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="cvmarket"] section[class~="lg:container"] > div[class~="grid"] {
                grid-template-columns: minmax(0, 1fr) !important;
                width: 100% !important;
            }
            body.li-tools-split-view[data-li-tools-site="cvmarket"] section[class~="lg:container"] > main,
            body.li-tools-split-view[data-li-tools-site="cvmarket"] .jobs-list { width: 100% !important; min-width: 0 !important; }
            body.li-tools-split-view[data-li-tools-site="cvlt"] > div[class~="lg:container"][class~="pt-7"] {
                width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                max-width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }
            @media (min-width: 1024px) {
                body.li-tools-split-view[data-li-tools-site="cvlt"] > div[class~="lg:container"][class~="pt-7"] {
                    padding-right: 2rem !important;
                    padding-left: 1rem !important;
                }
            }
            body.li-tools-split-view[data-li-tools-site="cvlt"] > div[class~="lg:container"][class~="pt-7"] > main {
                flex: 1 1 auto !important;
                width: auto !important;
                min-width: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="cvlt"] > div[class~="lg:container"][class~="pt-7"] > aside {
                flex: 0 1 30% !important;
                min-width: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="cvlt"] .jobs-list { width: 100% !important; min-width: 0 !important; }
            body.li-tools-split-view[data-li-tools-site="pinokis"] #main {
                box-sizing: border-box !important;
                width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                max-width: min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) !important;
                padding-left: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="pinokis"] #main > .wrapper,
            body.li-tools-split-view[data-li-tools-site="pinokis"] #content,
            body.li-tools-split-view[data-li-tools-site="pinokis"] #content .jobs-bg,
            body.li-tools-split-view[data-li-tools-site="pinokis"] #content .jobs-bg > .max-w-6xl {
                width: 100% !important;
                max-width: none !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="pinokis"] #main > .wrapper > aside {
                display: none !important;
            }
            body.li-tools-split-view[data-li-tools-site="uzt"] app-public-job-vacancy-search {
                flex: 0 0 calc(min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) - 32px) !important;
                width: calc(min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) - 32px) !important;
                max-width: calc(min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) - 32px) !important;
                min-width: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="uzt"] app-root.uztis-bootstrap {
                justify-content: flex-start !important;
                width: calc(min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) - 32px) !important;
                max-width: calc(min(var(--li-tools-results-width, 55vw), calc(100vw - var(--li-tools-preview-width, 45vw))) - 32px) !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="uzt"] app-public-job-vacancy-search > div {
                width: 100% !important;
                min-width: 0 !important;
            }
            body.li-tools-split-view[data-li-tools-site="uzt"] app-public-job-vacancy-search > div > main {
                flex: 1 1 auto !important;
                width: 100% !important;
                max-width: none !important;
                min-width: 0 !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }
            .li-tools-main-content {
                flex: 0 0 var(--li-tools-main-width, 100vw) !important;
                width: var(--li-tools-main-width, 100vw) !important;
                max-width: none !important;
                transform: translateX(min(0px, calc((100vw - var(--li-tools-main-width, 100vw)) / 2))) !important;
            }
            .li-tools-job-columns {
                width: 100% !important;
                min-width: 0 !important;
                grid-template-columns: minmax(300px, calc(100% - var(--li-tools-details-width, 65%))) minmax(0, var(--li-tools-details-width, 65%)) !important;
            }
            .li-tools-results-pane, .li-tools-details-pane { width: 100% !important; max-width: none !important; min-width: 0 !important; }
            .job-ad .react-tabs .react-tabs__tab-panel--selected .vacancy-highlights {
                position: relative !important;
                left: calc(100% + 25px) !important;
                width: 55% !important;
            }
        }
        @media (max-width: 700px) {
            #li-job-tools-panel:not([hidden]) { width: calc(100vw - 16px); height: calc(100vh - 58px); max-height: min(1000px, calc(100vh - 58px)); left: 8px; top: 50px; flex-direction: column; }
            .li-tools-column { min-width: 0; }
            #li-tools-editor { flex: 0 1 auto; width: 100%; }
            #li-tools-editor > .li-tools-section:not([hidden]) { flex: 1 1 auto; }
        }
        @media (forced-colors: active) {
            #li-job-tools-panel, #li-job-tools-panel button, #li-job-tools-panel input,
            .li-tools-menu button, .li-tools-card-menu, .li-tools-card-trigger,
            .li-tools-applied-checkbox, .li-tools-hidden-checkbox,
            .li-tools-title-pill, .li-tools-title-label, .li-tools-title-menu, .li-tools-title-menu button {
                border-color: ButtonBorder; background: Canvas; color: CanvasText;
            }
            .li-tools-applied-checkbox, .li-tools-hidden-checkbox {
                appearance: none !important;
                border: 0 !important;
                background: transparent !important;
            }
            .li-tools-applied-checkbox::after { filter: grayscale(1); }
            .li-tools-applied-checkbox:checked::after { filter: grayscale(0); }
            .li-tools-hidden-checkbox::before { filter: grayscale(1); }
            .li-tools-hidden-checkbox:checked::after { color: GrayText; }
            .li-tools-skill, .li-tools-salary-above, .li-tools-salary-below {
                background: Canvas !important; color: CanvasText !important; outline: 1px solid CanvasText;
            }
        }
    `;
    document.head.appendChild(style);

    const leftColumn = document.createElement('div');
    leftColumn.className = 'li-tools-column';
    leftColumn.hidden = true;
    const rightColumn = document.createElement('div');
    rightColumn.className = 'li-tools-column';
    panel.append(leftColumn, rightColumn);

    const status = document.createElement('div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.minHeight = '1em';

    function setStatus(message) {
        status.textContent = message;
    }

    function makeButton(label, handler, className = 'li-tools-button') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.className = className;
        button.addEventListener('click', () => handler(button));
        return button;
    }

    function heading(text) {
        const element = document.createElement('h2');
        element.className = 'li-tools-heading';
        element.textContent = text;
        return element;
    }

    function createField(labelText, value = '', type = 'text') {
        const input = document.createElement('input');
        input.type = type;
        input.value = value;
        input.defaultValue = value;
        input.setAttribute('aria-label', labelText);
        input.title = labelText;
        if (type !== 'color') input.placeholder = labelText;
        return input;
    }

    function setButtonIcon(button, pathData) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        svg.appendChild(path);
        button.appendChild(svg);
    }

    function createAddForm(fields, buttonText, submit) {
        const form = document.createElement('form');
        form.className = 'li-tools-form';
        const inputs = fields.map(field => {
            const control = createField(field.label, field.value || '', field.type || 'text');
            form.appendChild(control);
            return control;
        });
        const button = document.createElement('button');
        button.type = 'submit';
        button.className = 'li-tools-button';
        button.textContent = buttonText;
        form.appendChild(button);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const added = await submit(inputs.map(input => input.value));
            if (added) {
                form.reset();
                if (inputs[0].isConnected) inputs[0].focus();
            }
        });
        return form;
    }

    function createEditableRow(list, fields, onSave, onRemove) {
        const row = document.createElement('div');
        row.className = 'li-tools-row';
        const inputs = fields.map(field => {
            const control = createField(field.label, field.value, field.type || 'text');
            row.appendChild(control);
            return control;
        });
        let savedValues = inputs.map(input => input.value);
        let saving;
        async function saveRow() {
            const values = inputs.map(input => input.value);
            if (values.every((value, index) => value === savedValues[index])) return;
            if (saving) await saving;
            if (values.every((value, index) => value === savedValues[index])) return;
            saving = onSave(values);
            if (await saving) savedValues = values;
            saving = null;
        }
        const actions = document.createElement('div');
        actions.className = 'li-tools-row-actions';
        const description = fields.filter(field => field.type !== 'color').map(field => field.value).join(' + ');
        const saveButton = makeButton('', saveRow, 'li-tools-secondary li-tools-icon-button');
        setButtonIcon(saveButton, 'M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z');
        const updateLabels = () => {
            const current = inputs.filter(input => input.type !== 'color').map(input => input.value).join(' + ') || description || 'list item';
            saveButton.setAttribute('aria-label', `Save ${current}`);
            saveButton.title = `Save ${current}`;
            removeButton.setAttribute('aria-label', `Remove ${current}`);
            removeButton.title = `Remove ${current}`;
        };
        const removeButton = makeButton('', onRemove, 'li-tools-secondary li-tools-icon-button');
        setButtonIcon(removeButton, 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z');
        updateLabels();
        inputs.forEach(input => input.addEventListener('input', updateLabels));
        actions.append(saveButton, removeButton);
        row.appendChild(actions);
        row.addEventListener('focusout', event => {
            if (!row.contains(event.relatedTarget)) saveRow();
        });
        list.appendChild(row);
    }

    const phraseSection = document.createElement('section');
    phraseSection.className = 'li-tools-section';
    phraseSection.hidden = true;
    phraseSection.appendChild(heading('Blocked phrases'));
    const phraseList = document.createElement('div');
    phraseList.className = 'li-tools-list';
    phraseSection.append(
        createAddForm([{ label: 'Phrase to block' }], 'Add phrase', values => addListEntry('blockedPhrases', values)),
        phraseList
    );

    const employerSection = document.createElement('section');
    employerSection.className = 'li-tools-section';
    employerSection.hidden = true;
    employerSection.appendChild(heading('Blocked employers'));
    const employerList = document.createElement('div');
    employerList.className = 'li-tools-list';
    const employerPositionList = document.createElement('div');
    employerPositionList.className = 'li-tools-list';
    const employerPositionHeading = heading('Employer + position');
    employerSection.append(
        createAddForm([{ label: 'Employer to block' }], 'Add employer', values => addListEntry('blockedEmployers', values)),
        employerList,
        employerPositionHeading,
        createAddForm([{ label: 'Employer' }, { label: 'Position' }], 'Add employer + position', values => addListEntry('blockedEmployerPositions', values)),
        employerPositionList
    );

    const positionSection = document.createElement('section');
    positionSection.className = 'li-tools-section';
    positionSection.hidden = true;
    positionSection.appendChild(heading('Blocked positions'));
    const positionList = document.createElement('div');
    positionList.className = 'li-tools-list';
    positionSection.append(
        createAddForm([{ label: 'Position to block' }], 'Add position', values => addListEntry('blockedPositions', values)),
        positionList
    );

    const skillSection = document.createElement('section');
    skillSection.className = 'li-tools-section';
    skillSection.hidden = true;
    skillSection.appendChild(heading('Skills highlighter'));
    const skillCategoryForm = createAddForm([{ label: 'New skill category' }], 'Add category', addSkillCategory);
    const skillCategoriesList = document.createElement('div');
    skillCategoriesList.className = 'li-tools-skills';
    skillSection.append(
        skillCategoryForm,
        skillCategoriesList
    );
    leftColumn.append(phraseSection, employerSection, positionSection, skillSection);

    const editorSections = new Map([
        ['phrases', phraseSection],
        ['employers', employerSection],
        ['positions', positionSection],
        ['skills', skillSection]
    ]);

    function openEditor(name) {
        if (panel.hidden) {
            panel.hidden = false;
            toggleButton.setAttribute('aria-expanded', 'true');
        }
        editorSections.forEach(section => { section.hidden = true; });
        const section = editorSections.get(name);
        leftColumn.hidden = false;
        section.hidden = false;
        section.querySelector('input')?.focus();
    }

    function hideEditor() {
        leftColumn.hidden = true;
        editorSections.forEach(section => { section.hidden = true; });
    }

    function createListNavigation() {
        const listNavigation = document.createElement('div');
        listNavigation.className = 'li-tools-section';
        listNavigation.appendChild(heading('Lists'));
        for (const [label, name] of [
            ['Blocked phrases', 'phrases'],
            ['Blocked employers', 'employers'],
            ['Blocked positions', 'positions'],
            ['Skills highlighter', 'skills']
        ]) {
            const button = makeButton(label, () => openEditor(name), 'li-tools-secondary');
            button.setAttribute('aria-controls', leftColumn.id || 'li-tools-editor');
            listNavigation.appendChild(button);
        }
        listNavigation.appendChild(makeButton('Import/export', openSettingsDialog, 'li-tools-secondary'));
        return listNavigation;
    }
    leftColumn.id = 'li-tools-editor';

    const skillLabel = document.createElement('label');
    const skillToggle = document.createElement('input');
    skillToggle.type = 'checkbox';
    skillToggle.checked = settings.skillsEnabled;
    skillLabel.append(skillToggle, ' Highlight skills');
    skillToggle.addEventListener('change', async () => {
        settings.skillsEnabled = skillToggle.checked;
        const saved = await saveSettings();
        setStatus(saved ? 'Skill highlighting setting saved.' : 'Could not save settings. Check the console.');
        processPage();
    });

    const filterSection = document.createElement('div');
    filterSection.className = 'li-tools-section';
    filterSection.appendChild(heading('Job filters'));
    filterSection.appendChild(makeButton('Show all jobs', async () => {
        hideEditor();
        settings.activeFilter = FILTERS.SHOW_ALL;
        await saveSettings();
        applyFilter();
    }));
    filterSection.appendChild(makeButton('Promoted only', async () => {
        hideEditor();
        settings.activeFilter = FILTERS.SHOW_PROMOTED;
        await saveSettings();
        applyFilter();
    }));
    filterSection.appendChild(makeButton('Normal jobs only', async () => {
        hideEditor();
        settings.activeFilter = FILTERS.SHOW_NORMAL;
        await saveSettings();
        applyFilter();
    }));

    const filterToggleButtons = new Map();
    function addToggle(label, key) {
        const button = makeButton(`${label}: ${settings[key] ? 'On' : 'Off'}`, async target => {
            hideEditor();
            settings[key] = !settings[key];
            target.textContent = `${label}: ${settings[key] ? 'On' : 'Off'}`;
            await saveSettings();
            applyFilter();
        });
        filterToggleButtons.set(key, { label, button });
        filterSection.appendChild(button);
    }
    addToggle('Only unviewed', 'onlyUnviewed');
    addToggle('Hide hidden', 'onlyUnhidden');
    addToggle('Hide applied', 'onlyUnapplied');
    rightColumn.append(filterSection, createListNavigation(), skillLabel);

    const salaryLabel = document.createElement('label');
    salaryLabel.className = 'li-tools-field';
    salaryLabel.append('Minimum salary (monthly; listings within 10% below are included)');
    const salaryInput = document.createElement('input');
    salaryInput.type = 'number';
    salaryInput.min = '0';
    salaryInput.step = '100';
    salaryInput.value = String(settings.salaryMinimum);
    salaryLabel.appendChild(salaryInput);
    rightColumn.appendChild(salaryLabel);
    salaryInput.addEventListener('change', async () => {
        settings.salaryMinimum = Math.max(0, Number(salaryInput.value) || 0);
        salaryInput.value = String(settings.salaryMinimum);
        await saveSettings();
        processPage();
    });

    const layoutSection = document.createElement('div');
    layoutSection.className = 'li-tools-section';
    layoutSection.appendChild(heading('Page layout'));
    const layoutSite = getSite();
    const splitLayout = splitViewSites.has(layoutSite);
    const layoutSettings = splitLayout ? settings.splitViewWidths[layoutSite] : settings;
    layoutSection.hidden = !splitLayout && layoutSite !== 'linkedin';
    const layoutControls = new Map();
    function addRange(labelText, key, min, max, suffix) {
        const label = document.createElement('label');
        label.className = 'li-tools-field';
        const text = document.createElement('span');
        const input = document.createElement('input');
        input.className = 'li-tools-range';
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.value = String(layoutSettings[key]);
        input.setAttribute('aria-label', labelText);
        const update = () => {
            const currentLayoutSettings = splitLayout ? settings.splitViewWidths[layoutSite] : settings;
            currentLayoutSettings[key] = Number(input.value);
            text.textContent = `${labelText}: ${currentLayoutSettings[key]}${suffix}`;
            updateLayout();
        };
        layoutControls.set(key, { input, text, labelText, suffix });
        input.addEventListener('input', update);
        input.addEventListener('change', async () => {
            await saveSettings();
        });
        label.append(text, input);
        layoutSection.appendChild(label);
        update();
    }
    addRange(splitLayout ? 'Results pane share' : 'Main content width', 'mainWidth',
        splitLayout ? 30 : 70, splitLayout ? 70 : 140, '%');
    if (!splitLayout) addRange('Details pane width', 'detailsWidth', 50, 85, '%');
    rightColumn.appendChild(layoutSection);

    rightColumn.appendChild(status);

    function openSettingsDialog(trigger) {
        const dialog = document.createElement('dialog');
        dialog.id = 'li-tools-settings-dialog';
        dialog.setAttribute('aria-labelledby', 'li-tools-settings-title');
        const title = document.createElement('h2');
        title.id = 'li-tools-settings-title';
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
        const cvSection = document.createElement('section');
        const cvTitle = document.createElement('h3');
        cvTitle.textContent = 'Preferred CV for Pinokis';
        const cvDescription = document.createElement('p');
        cvDescription.id = 'li-tools-preferred-cv-description';
        cvDescription.textContent = 'The file stays in its original location. A file handle is stored on Pinokis.com and may be used by page scripts when browser permission is granted. It is not included in settings JSON.';
        const cvStatus = document.createElement('div');
        cvStatus.setAttribute('role', 'status');
        cvStatus.setAttribute('aria-live', 'polite');
        cvStatus.style.minHeight = '1em';
        const chooseCV = makeButton('Choose and remember CV', async () => {
            let handle;
            try {
                const pickerWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
                [handle] = await pickerWindow.showOpenFilePicker.call(pickerWindow, {
                    multiple: false,
                    types: [{
                        description: 'CV document',
                        accept: {
                            'application/pdf': ['.pdf'],
                            'application/msword': ['.doc'],
                            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
                        }
                    }]
                });
            } catch (error) {
                if (error.name === 'AbortError') {
                    cvStatus.textContent = 'File selection canceled.';
                    return;
                }
                console.error('Job Search Toolkit: preferred CV picker failed.', error);
                cvStatus.textContent = `Browser could not open its persistent file picker (${error.name || 'error'}: ${error.message || 'no details'}).`;
                return;
            }
            try {
                const file = await handle.getFile();
                if (!isSupportedCV(file)) {
                    cvStatus.textContent = 'Choose a non-empty PDF, DOC, or DOCX file no larger than 30 MB.';
                    return;
                }
                await savePreferredCVHandle(handle);
                cvStatus.textContent = `Preferred CV saved: ${handle.name}.`;
                forgetCV.hidden = false;
                useCV.hidden = false;
                const input = pinokisCVInput(jobPreviewFrame?.contentDocument) || pinokisCVInput();
                if (input) await fillPinokisCV(input, true, message => { cvStatus.textContent = message; });
            } catch (error) {
                console.error('Job Search Toolkit: could not save or access the preferred CV handle.', error);
                cvStatus.textContent = `Could not remember or access the selected CV (${error.name || 'error'}: ${error.message || 'no details'}).`;
            }
        });
        const useCV = makeButton('Grant access and attach saved CV', async () => {
            const input = pinokisCVInput(jobPreviewFrame?.contentDocument) || pinokisCVInput();
            if (!input) {
                cvStatus.textContent = 'Select a Pinokis vacancy with a CV upload field, then try again.';
                return;
            }
            try {
                await fillPinokisCV(input, true, message => { cvStatus.textContent = message; });
            } catch (error) {
                console.error('Job Search Toolkit: could not attach the preferred CV.', error);
                cvStatus.textContent = 'Could not access the preferred CV. Check browser permission.';
            }
        });
        const forgetCV = makeButton('Forget preferred CV', async () => {
            try {
                await removePreferredCVHandle();
                cvStatus.textContent = 'Preferred CV forgotten.';
                forgetCV.hidden = true;
                useCV.hidden = true;
            } catch (error) {
                console.error('Job Search Toolkit: could not forget the preferred CV.', error);
                cvStatus.textContent = 'Could not remove the preferred CV. Check browser storage.';
            }
        });
        const onPinokis = getSite() === 'pinokis';
        chooseCV.hidden = !onPinokis;
        useCV.hidden = true;
        forgetCV.hidden = true;
        cvSection.append(cvTitle, cvDescription, chooseCV, useCV, forgetCV, cvStatus);

        const fieldLabel = document.createElement('label');
        fieldLabel.htmlFor = 'li-tools-settings-json';
        const field = document.createElement('textarea');
        field.id = fieldLabel.htmlFor;
        field.spellcheck = false;
        const actions = document.createElement('div');
        actions.setAttribute('data-settings-actions', '');
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Close';
        close.addEventListener('click', () => dialog.close());
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Import';
        actions.append(close, submit);
        const form = document.createElement('form');
        const message = document.createElement('div');
        message.setAttribute('role', 'status');
        message.setAttribute('aria-live', 'polite');
        message.style.minHeight = '1em';
        form.append(fieldLabel, field, message, actions);
        dialog.append(title, modeButtons, cvSection, form);

        if (!onPinokis) {
            cvDescription.textContent = 'Open Pinokis.com to choose a preferred CV. The file stays in its original location and is not included in settings JSON.';
        } else {
            getPreferredCVHandle().then(handle => {
                if (!dialog.isConnected) return;
                if (handle) {
                    cvStatus.textContent = `Preferred CV saved: ${handle.name}.`;
                    forgetCV.hidden = false;
                    useCV.hidden = false;
                    useCV.textContent = 'Grant access if needed and attach saved CV';
                } else {
                    cvStatus.textContent = 'No preferred CV selected.';
                }
            }).catch(error => {
                console.error('Job Search Toolkit: could not load the preferred CV.', error);
                cvStatus.textContent = 'Could not read the preferred CV setting. Check browser storage.';
            });
        }

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
                    navigator.clipboard.writeText(field.value).then(
                        () => { message.textContent = 'Settings JSON copied to clipboard.'; },
                        error => {
                            console.warn('Job Search Toolkit: could not copy exported settings.', error);
                            message.textContent = 'JSON selected, but clipboard access failed. Copy it manually.';
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
            const previous = settings;
            normalizeSettings(imported);
            if (!await saveSettings()) {
                settings = previous;
                message.textContent = 'Could not save imported settings. Existing settings were kept.';
                return;
            }
            skillToggle.checked = settings.skillsEnabled;
            salaryInput.value = String(settings.salaryMinimum);
            filterToggleButtons.forEach(({ label, button }, key) => {
                button.textContent = `${label}: ${settings[key] ? 'On' : 'Off'}`;
            });
            layoutControls.forEach(({ input, text, labelText, suffix }, key) => {
                const currentLayoutSettings = splitLayout ? settings.splitViewWidths[layoutSite] : settings;
                input.value = String(currentLayoutSettings[key]);
                text.textContent = `${labelText}: ${currentLayoutSettings[key]}${suffix}`;
            });
            renderBlockedLists();
            processPage();
            message.textContent = 'Settings imported and saved.';
        });
        dialog.addEventListener('close', () => {
            dialog.remove();
            trigger.focus();
        }, { once: true });
        document.body.appendChild(dialog);
        dialog.showModal();
        setMode('import');
    }

    function updateLayout() {
        const site = getSite();
        if (splitViewSites.has(site)) {
            const widths = settings.splitViewWidths[site];
            document.documentElement.style.setProperty('--li-tools-results-width', `${widths.mainWidth}vw`);
            document.documentElement.style.setProperty('--li-tools-preview-width', `${100 - widths.mainWidth}vw`);
        } else {
            document.documentElement.style.setProperty('--li-tools-main-width', `${settings.mainWidth}vw`);
            document.documentElement.style.setProperty('--li-tools-details-width', `${settings.detailsWidth}%`);
        }
        document.querySelectorAll('.li-tools-main-content, .li-tools-results-pane, .li-tools-details-pane, .li-tools-job-columns')
            .forEach(element => element.classList.remove('li-tools-main-content', 'li-tools-results-pane', 'li-tools-details-pane', 'li-tools-job-columns'));
        const lazyColumns = Array.from(document.querySelectorAll('[data-testid="lazy-column"]'));
        const resultsPane = lazyColumns.find(column => column.querySelector('div[role="button"] button[aria-label="More options"]'));
        const aboutHeading = Array.from(document.querySelectorAll('h2')).find(element => element.innerText.trim() === 'About the job');
        const detailsPane = aboutHeading?.closest('[data-testid="lazy-column"]');
        let columns = resultsPane?.parentElement;
        while (columns && (!columns.contains(detailsPane) || getComputedStyle(columns).display === 'contents')) {
            columns = columns.parentElement;
        }
        columns?.parentElement?.classList.add('li-tools-main-content');
        resultsPane?.classList.add('li-tools-results-pane');
        detailsPane?.classList.add('li-tools-details-pane');
        columns?.classList.add('li-tools-job-columns');
    }
    updateLayout();

    function normalized(value) {
        return value.trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function includesListingText(text, value) {
        return normalized(text).includes(normalized(value));
    }

    function getSite() {
        const hostname = location.hostname.toLowerCase();
        if (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')) return 'linkedin';
        if (hostname === 'cvbankas.lt' || hostname.endsWith('.cvbankas.lt')) return 'cvbankas';
        if (hostname === 'cvonline.lt' || hostname.endsWith('.cvonline.lt')) return 'cvonline';
        if (hostname === 'cvmarket.lt' || hostname.endsWith('.cvmarket.lt')) return 'cvmarket';
        if (hostname === 'cv.lt' || hostname.endsWith('.cv.lt')) return 'cvlt';
        if (hostname === 'pinokis.com' || hostname.endsWith('.pinokis.com')) return 'pinokis';
        if (hostname === 'jobs.workinlithuania.com') return 'workinlithuania';
        if (hostname === 'uzt.lt') return 'uzt';
        return '';
    }

    function getJobDetails(card) {
        const site = getSite();
        if (site === 'cvbankas') {
            return {
                position: card.querySelector('.list_h3')?.innerText.trim() || '',
                company: card.querySelector('.heading_secondary .dib')?.innerText.trim()
                    || card.querySelector('.list_logo_c img')?.alt.replace(/\s+darbo skelbimai$/i, '').trim()
                    || ''
            };
        }
        if (site === 'cvonline') {
            return {
                position: card.querySelector('.vacancy-item__title')?.innerText.trim() || '',
                company: card.querySelector('[data-testid^="vacancy-item-link-employer-"]')?.innerText.trim()
                    || card.querySelector('.vacancy-item__logo img')?.alt.trim()
                    || ''
            };
        }
        if (site === 'cvmarket') {
            return {
                position: card.querySelector('h2')?.innerText.trim() || '',
                company: card.querySelector('.job-company')?.innerText.trim() || ''
            };
        }
        if (site === 'cvlt') {
            return {
                position: card.querySelector('.job-title')?.innerText.trim() || '',
                company: card.querySelector('.job-company')?.innerText.trim() || ''
            };
        }
        if (site === 'pinokis') {
            return {
                position: card.querySelector('h2 a[href*="/darbo-skelbimai/"]')?.innerText.trim() || '',
                company: card.querySelector('a[href*="/atsiliepimai/imone/"]')?.innerText.trim()
                    || card.querySelector('img[alt*="logotipas" i]')?.alt.replace(/\s+logotipas$/i, '').trim()
                    || ''
            };
        }
        if (site === 'workinlithuania') {
            return {
                position: card.querySelector('h3')?.innerText.trim() || '',
                company: card.querySelector('h2')?.innerText.trim() || ''
            };
        }
        if (site === 'uzt') {
            const lines = card.innerText.split('\n').map(line => line.trim()).filter(line =>
                line && !/^(?:apartment|•)$/i.test(line) && !/€|Paskelbta prieš/i.test(line)
            );
            return { position: lines[0] || '', company: lines[1] || '' };
        }
        const paragraphs = Array.from(card.querySelectorAll('p')).map(element => element.innerText.trim()).filter(Boolean);
        const title = card.querySelector('a.job-card-list__title--link')?.innerText.trim()
            || paragraphs[0]?.split('\n').pop().replace(/\s+\(Verified job\)$/i, '').trim()
            || '';
        const company = card.querySelector('.job-card-container__primary-description, .artdeco-entity-lockup__subtitle')?.innerText
            .trim().split(/\n| · /)[0].trim()
            || paragraphs[1]?.split('\n')[0].trim()
            || '';
        return { company, position: title };
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
        if (key === 'blockedEmployerPositions') {
            return normalized(first.company) === normalized(second.company)
                && normalized(first.position) === normalized(second.position);
        }
        return normalized(first) === normalized(second);
    }

    async function addListEntry(key, values) {
        const entry = makeListEntry(key, values);
        if (values.some(value => !value.trim())) {
            setStatus('Enter a value for every field.');
            return false;
        }
        if (settings[key].some(item => sameListEntry(key, item, entry))) {
            setStatus('That item is already in the list.');
            return false;
        }
        settings[key].push(entry);
        const saved = await saveSettings();
        renderBlockedLists();
        applyFilter();
        setStatus(saved ? 'List item added.' : 'Could not save settings. Check the console.');
        return true;
    }

    async function updateListEntry(key, index, values) {
        const entry = makeListEntry(key, values);
        if (values.some(value => !value.trim())) {
            setStatus('Enter a value for every field.');
            return false;
        }
        if (settings[key].some((item, itemIndex) => itemIndex !== index && sameListEntry(key, item, entry))) {
            setStatus('That item is already in the list.');
            return false;
        }
        settings[key][index] = entry;
        const saved = await saveSettings();
        applyFilter();
        setStatus(saved ? 'List item updated.' : 'Could not save settings. Check the console.');
        return saved;
    }

    async function removeListEntry(key, index) {
        settings[key].splice(index, 1);
        const saved = await saveSettings();
        renderBlockedLists();
        applyFilter();
        setStatus(saved ? 'List item removed.' : 'Could not save settings. Check the console.');
        const section = key === 'blockedPhrases' ? phraseSection
            : key === 'blockedEmployers' || key === 'blockedEmployerPositions' ? employerSection : positionSection;
        section.querySelector('form input')?.focus();
    }

    function renderList(key, list, labels) {
        list.replaceChildren();
        settings[key].forEach((item, index) => {
            const values = listValues(key, item);
            createEditableRow(list, labels.map((label, fieldIndex) => ({
                label,
                value: values[fieldIndex]
            })), updated => updateListEntry(key, index, updated),
            () => removeListEntry(key, index));
        });
    }

    function renderBlockedLists() {
        renderList('blockedPhrases', phraseList, ['Blocked phrase']);
        renderList('blockedEmployers', employerList, ['Blocked employer']);
        renderList('blockedEmployerPositions', employerPositionList, ['Employer', 'Position']);
        renderList('blockedPositions', positionList, ['Blocked position']);
        renderSkills();
    }

    async function addSkill(values, group) {
        const name = values[0].trim();
        const color = values[1];
        if (!name || !/^#[\da-f]{6}$/i.test(color)) {
            setStatus('Enter a skill and choose a valid highlight color.');
            return false;
        }
        if (settings.skills.some(skill => normalized(skill.name) === normalized(name))) {
            setStatus('That skill is already in the list.');
            return false;
        }
        settings.skills.push({ name, color, group });
        const saved = await saveSettings();
        renderSkills();
        const groupEditor = Array.from(skillCategoriesList.querySelectorAll('details'))
            .find(item => item.dataset.category === group);
        groupEditor?.querySelector('form input')?.focus();
        processPage();
        setStatus(saved ? 'Skill added.' : 'Could not save settings. Check the console.');
        return true;
    }

    async function addSkillCategory(values) {
        const label = values[0].trim();
        if (!label) {
            setStatus('Enter a category name.');
            return false;
        }
        if (settings.skillCategories.some(category => normalized(category.label) === normalized(label))) {
            setStatus('That category is already in the list.');
            return false;
        }
        const baseId = `category-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom'}`;
        let id = baseId;
        let suffix = 2;
        while (settings.skillCategories.some(category => category.id === id)) id = `${baseId}-${suffix++}`;
        settings.skillCategories.push({ id, label });
        const saved = await saveSettings();
        renderSkills();
        setStatus(saved ? 'Skill category added.' : 'Could not save settings. Check the console.');
        return true;
    }

    async function updateSkill(index, values) {
        const name = values[0].trim();
        const color = values[1];
        if (!name || !/^#[\da-f]{6}$/i.test(color)) {
            setStatus('Enter a skill and choose a valid highlight color.');
            return false;
        }
        if (settings.skills.some((skill, skillIndex) => skillIndex !== index && normalized(skill.name) === normalized(name))) {
            setStatus('That skill is already in the list.');
            return false;
        }
        settings.skills[index] = { ...settings.skills[index], name, color };
        const saved = await saveSettings();
        processPage();
        setStatus(saved ? 'Skill updated.' : 'Could not save settings. Check the console.');
        return saved;
    }

    async function removeSkill(index) {
        const group = settings.skills[index].group;
        settings.skills.splice(index, 1);
        const saved = await saveSettings();
        renderSkills();
        processPage();
        setStatus(saved ? 'Skill removed.' : 'Could not save settings. Check the console.');
        const groupEditor = Array.from(skillCategoriesList.querySelectorAll('details'))
            .find(item => item.dataset.category === group);
        if (groupEditor) {
            groupEditor.open = true;
            groupEditor.querySelector('form input')?.focus();
        }
    }

    function renderSkills() {
        const openGroups = new Set(Array.from(skillCategoriesList.querySelectorAll('details[open]'), group => group.dataset.category));
        skillCategoriesList.replaceChildren();
        settings.skillCategories.forEach(category => {
            const group = document.createElement('details');
            group.className = 'li-tools-skill-group';
            group.dataset.category = category.id;
            group.open = openGroups.has(category.id);
            const summary = document.createElement('summary');
            summary.textContent = category.label;
            const skillsList = document.createElement('div');
            skillsList.className = 'li-tools-list';
            settings.skills.forEach((skill, index) => {
                if (skill.group !== category.id) return;
                createEditableRow(skillsList, [
                    { label: 'Skill', value: skill.name },
                    { label: 'Highlight color', value: skill.color, type: 'color' }
                ], values => updateSkill(index, values), () => removeSkill(index));
            });
            group.append(
                summary,
                createAddForm([
                    { label: 'Skill to highlight' },
                    { label: 'Highlight color', type: 'color', value: skillGroupColors[category.id] || '#fff2b3' }
                ], 'Add skill', values => addSkill(values, category.id)),
                skillsList
            );
            skillCategoriesList.appendChild(group);
        });
    }
    renderBlockedLists();

    const hiddenNoticePattern = /we won['’]t (?:show you this job|recommend this job anymore)/i;

    function getJobCards() {
        const site = getSite();
        if (site === 'cvbankas') {
            return Array.from(document.querySelectorAll('article.list_article'))
                .filter(card => card.querySelector('.list_a[href]'));
        }
        if (site === 'cvonline') {
            return Array.from(document.querySelectorAll('.vacancy-item'))
                .filter(card => card.querySelector('a[href*="/vacancy/"]'));
        }
        if (site === 'cvmarket') {
            return Array.from(document.querySelectorAll('.jobs-list > article'))
                .filter(card => card.querySelector('a.jobad-url'));
        }
        if (site === 'cvlt') {
            return Array.from(document.querySelectorAll('.jobs-list > article[data-component="jobad"]'))
                .filter(card => card.querySelector('.job-title'));
        }
        if (site === 'pinokis') {
            return Array.from(document.querySelectorAll('.jobs-bg article'))
                .filter(card => card.querySelector('h2 a[href*="/darbo-skelbimai/"]'));
        }
        if (site === 'workinlithuania') {
            return Array.from(document.querySelectorAll('a[href]'))
                .filter(link => /view job/i.test(link.innerText) && link.querySelector('button'))
                .map(link => link.parentElement?.parentElement)
                .filter(Boolean);
        }
        if (site === 'uzt') {
            return Array.from(document.querySelectorAll('app-public-job-vacancy-search a[href*="/skelbimas/"]'));
        }
        const legacyCards = Array.from(document.querySelectorAll('li[data-occludable-job-id]'));
        const currentCards = Array.from(document.querySelectorAll('div[role="button"]'))
            .filter(card => card.querySelector('button[aria-label^="Dismiss"]')
                || hiddenNoticePattern.test(card.textContent || ''));
        return Array.from(new Set([...legacyCards, ...currentCards]));
    }

    let jobPreview;
    let jobPreviewTitle;
    let jobPreviewFrame;
    let selectedJobUrl = '';
    let autoPaginationTimer;
    const attemptedPaginationPages = new Set();
    const previewObservers = new WeakMap();
    const previewLinkObservers = new WeakMap();
    const previewDescriptionFrames = new WeakSet();
    const skillContextMenuDocuments = new WeakSet();
    const skillContextMenuFrames = new WeakSet();

    function addSkillSelectionMenu(doc, root) {
        if (skillContextMenuDocuments.has(doc)) return;
        skillContextMenuDocuments.add(doc);
        doc.addEventListener('contextmenu', event => {
            const selection = doc.defaultView.getSelection();
            const name = selection?.toString().trim();
            const anchor = selection?.anchorNode;
            if (!name || !anchor || !(anchor === root || root.contains(anchor.nodeType === 1 ? anchor : anchor.parentElement))) return;
            event.preventDefault();
            doc.querySelector('.li-tools-skill-context')?.remove();

            const menu = doc.createElement('form');
            menu.className = 'li-tools-skill-context';
            menu.dataset.liJobTools = '1';
            menu.setAttribute('aria-label', `Add ${name} to skills`);
            if (!doc.getElementById('li-job-tools-skill-context-style')) {
                const style = doc.createElement('style');
                style.id = 'li-job-tools-skill-context-style';
                style.textContent = `
                    .li-tools-skill-context button:focus-visible,
                    .li-tools-skill-context input:focus-visible { outline: 3px solid #075a9c; outline-offset: 2px; }
                    .li-tools-skill-context button[aria-pressed="true"] { outline: 2px solid #202124; outline-offset: 2px; }
                    @media (forced-colors: active) {
                        .li-tools-skill-context, .li-tools-skill-context button,
                        .li-tools-skill-context input { border-color: ButtonBorder !important; background: Canvas !important; color: CanvasText !important; }
                        .li-tools-skill-context button:focus-visible,
                        .li-tools-skill-context input:focus-visible,
                        .li-tools-skill-context button[aria-pressed="true"] { outline-color: Highlight; }
                    }
                `;
                doc.head.appendChild(style);
            }
            Object.assign(menu.style, {
                position: 'fixed', zIndex: '2147483647', display: 'flex', alignItems: 'end',
                flexWrap: 'wrap', maxWidth: 'calc(100vw - 16px)', gap: '8px', padding: '10px', border: '1px solid #5f6368', borderRadius: '6px',
                background: '#fff', color: '#202124', boxShadow: '0 2px 8px rgba(0,0,0,.2)'
            });
            const colorLabel = doc.createElement('label');
            colorLabel.textContent = 'Highlight color';
            Object.assign(colorLabel.style, { display: 'grid', gap: '4px', font: '14px sans-serif' });
            const color = doc.createElement('input');
            color.type = 'color';
            color.value = '#fff2b3';
            color.setAttribute('aria-label', 'Highlight color');
            colorLabel.appendChild(color);
            const quickColors = doc.createElement('div');
            Object.assign(quickColors.style, {
                display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '190px'
            });
            const palette = [
                ['Green', '#00ff00'],
                ['Red', '#ff0000'],
                ['Yellow', '#ffff00'],
                ['Pink', '#ff00ff'],
                ['Light blue', '#d7efff'],
                ['Light yellow', '#fff8cc']
            ];
            const swatches = palette.map(([label, value]) => {
                const button = doc.createElement('button');
                button.type = 'button';
                button.setAttribute('aria-label', label);
                button.setAttribute('aria-pressed', String(color.value === value));
                Object.assign(button.style, {
                    width: '30px', height: '30px', padding: '0', border: '1px solid #5f6368',
                    borderRadius: '4px', background: value, cursor: 'pointer'
                });
                button.addEventListener('click', () => {
                    color.value = value;
                    swatches.forEach(swatch => swatch.setAttribute('aria-pressed', String(swatch === button)));
                });
                quickColors.appendChild(button);
                return button;
            });
            color.addEventListener('input', () => {
                swatches.forEach((swatch, index) => {
                    swatch.setAttribute('aria-pressed', String(palette[index][1] === color.value));
                });
            });
            const save = doc.createElement('button');
            save.type = 'submit';
            save.textContent = 'Save skill';
            Object.assign(save.style, {
                minHeight: '36px', padding: '6px 10px', border: '1px solid #075a9c',
                borderRadius: '4px', background: '#075a9c', color: '#fff', font: '14px sans-serif',
                cursor: 'pointer', outlineOffset: '2px'
            });
            menu.append(colorLabel, quickColors, save);
            const closeMenu = () => {
                menu.remove();
                doc.removeEventListener('pointerdown', closeOnOutside, true);
            };
            const closeOnOutside = pointerEvent => {
                if (!menu.contains(pointerEvent.target)) closeMenu();
            };
            menu.addEventListener('submit', async submitEvent => {
                submitEvent.preventDefault();
                if (await addSkill([name, color.value], 'custom')) closeMenu();
            });
            doc.body.appendChild(menu);
            const bounds = menu.getBoundingClientRect();
            menu.style.left = `${Math.max(8, Math.min(event.clientX, doc.documentElement.clientWidth - bounds.width - 8))}px`;
            menu.style.top = `${Math.max(8, Math.min(event.clientY, doc.documentElement.clientHeight - bounds.height - 8))}px`;
            color.focus();
            menu.addEventListener('keydown', keyEvent => {
                if (keyEvent.key === 'Escape') closeMenu();
            });
            doc.addEventListener('pointerdown', closeOnOutside, true);
        });
        const addFrameMenu = frame => {
            if (!skillContextMenuFrames.has(frame)) {
                frame.addEventListener('load', () => {
                    try {
                        const frameDoc = frame.contentDocument;
                        if (frameDoc?.body) addSkillSelectionMenu(frameDoc, frameDoc.body);
                    } catch (error) {
                        if (error?.name !== 'SecurityError') {
                            console.warn('Job Search Toolkit: could not access a vacancy details frame.', error);
                        }
                    }
                });
                skillContextMenuFrames.add(frame);
            }
            try {
                const frameDoc = frame.contentDocument;
                if (frameDoc?.body) addSkillSelectionMenu(frameDoc, frameDoc.body);
            } catch (error) {
                if (error?.name !== 'SecurityError') {
                    console.warn('Job Search Toolkit: could not access a vacancy details frame.', error);
                }
            }
        };
        root.querySelectorAll('iframe, frame').forEach(addFrameMenu);
    }

    function getJobPreviewDetails(doc, site) {
        if (site === 'cvbankas') return doc.querySelector('#jobad_content_main');
        if (site === 'cvonline') return doc.querySelector('.vacancy-content');
        if (site === 'cvmarket') return doc.querySelector('body > div[class~="lg:container"]');
        if (site === 'cvlt') return doc.querySelector('body > div[class~="lg:container"][class~="pt-6"] main');
        if (site === 'pinokis') return doc.querySelector('#content .jobs-bg > .max-w-6xl');
        if (site === 'uzt') return doc.querySelector('app-public-job-vacancy-detail main');
        return null;
    }

    function openPreviewLinksInNewTabs(root) {
        if (!root.querySelectorAll) return;
        const links = [];
        if (root.nodeType === 1 && root.matches('a[href]')) links.push(root);
        links.push(...root.querySelectorAll('a[href]'));
        links.forEach(link => {
            link.target = '_blank';
            const rel = new Set(link.rel.split(/\s+/).filter(Boolean));
            rel.add('noopener');
            link.rel = [...rel].join(' ');
        });
    }

    function enhanceCvltDescriptionFrame(doc) {
        const frame = doc.querySelector('#htmlContentIframe')
            || doc.querySelector('body > div[class~="lg:container"][class~="pt-6"] main > div[class~="px-5"][class~="py-6"] iframe');
        if (!frame) return;
        const enhanceFrame = currentFrame => {
            if (!previewDescriptionFrames.has(currentFrame)) {
                currentFrame.addEventListener('load', () => enhanceCvltDescriptionFrame(doc));
                previewDescriptionFrames.add(currentFrame);
            }
            let descriptionDoc;
            try {
                descriptionDoc = currentFrame.contentDocument;
            } catch {
                return;
            }
            if (!descriptionDoc?.head || !descriptionDoc.body) return;
            let style = descriptionDoc.getElementById('li-job-tools-description-style');
            if (!style) {
                style = descriptionDoc.createElement('style');
                style.id = 'li-job-tools-description-style';
                style.textContent = `
                    .li-tools-skill { border-radius: 2px; padding: 0 2px; font-weight: 600; }
                    .li-tools-salary-above { background: #d8f3d4 !important; color: #173d12 !important; text-decoration: underline !important; }
                    .li-tools-salary-below { background: #ffe3dc !important; color: #5b2115 !important; text-decoration: underline wavy !important; }
                    @media (forced-colors: active) {
                        .li-tools-skill, .li-tools-salary-above, .li-tools-salary-below {
                            background: Canvas !important; color: CanvasText !important; outline: 1px solid CanvasText;
                        }
                    }
                `;
                descriptionDoc.head.appendChild(style);
            }
            const body = descriptionDoc.body;
            addSkillSelectionMenu(descriptionDoc, body);
            highlightSkills(body);
            highlightSalaries(body);
            if (!previewObservers.has(body)) {
                const observer = new descriptionDoc.defaultView.MutationObserver(() => {
                    highlightSkills(body);
                    highlightSalaries(body);
                });
                observer.observe(body, { childList: true, characterData: true, subtree: true });
                previewObservers.set(body, observer);
            }
            descriptionDoc.querySelectorAll('iframe, frame').forEach(enhanceFrame);
        };
        enhanceFrame(frame);
    }

    function enhanceJobPreviewFrame() {
        const doc = jobPreviewFrame?.contentDocument;
        const site = getSite();
        if (!doc?.head || !splitViewSites.has(site)) return;
        if (site === 'pinokis') {
            schedulePreferredCVFill(doc);
            observePinokisAppliedConfirmation(doc);
        }
        openPreviewLinksInNewTabs(doc);
        if (!previewLinkObservers.has(doc)) {
            const observer = new doc.defaultView.MutationObserver(records => {
                records.forEach(record => record.addedNodes.forEach(openPreviewLinksInNewTabs));
            });
            observer.observe(doc.body, { childList: true, subtree: true });
            previewLinkObservers.set(doc, observer);
        }
        let previewStyle = doc.getElementById('li-job-tools-preview-style');
        if (!previewStyle) {
            previewStyle = doc.createElement('style');
            previewStyle.id = 'li-job-tools-preview-style';
            previewStyle.textContent = `
                .li-tools-skill { border-radius: 2px; padding: 0 2px; font-weight: 600; }
                .li-tools-salary-above { background: #d8f3d4 !important; color: #173d12 !important; text-decoration: underline !important; }
                .li-tools-salary-below { background: #ffe3dc !important; color: #5b2115 !important; text-decoration: underline wavy !important; }
                ${site === 'cvonline' ? `
                    div.page-container > div.page-wrapper { padding-top: 0 !important; }
                    .page-content { padding: 0 !important; }
                    .breadcrumbs, #similarContainer, .page-content--column { display: none !important; }
                    .vacancy-content-header-cover__area { height: 120px !important; }
                ` : ''}
                ${site === 'cvlt' ? `
                    body > div[class~="lg:container"][class~="pt-6"][class~="lg:pt-12"][class~="pb-10"][class~="lg:pb-20"] {
                        padding-top: 0 !important;
                    }
                    body > footer { display: none !important; }
                    body > div[class~="lg:container"][class~="pt-6"][class~="lg:pt-12"][class~="pb-10"][class~="lg:pb-20"] > div[class~="mt-5"][class~="flex"][class~="flex-col"] {
                        margin-top: 0 !important;
                    }
                    body > div[class~="lg:container"][class~="pt-6"] > div[class~="mt-5"][class~="flex"] > aside {
                        display: none !important;
                    }
                    main { padding-bottom: 6rem !important; }
                    main > header, main > hr, main > div.sticky, #send-to-friend,
                    main > div[class~="px-5"] > .lg\\:hidden {
                        display: none !important;
                    }
                    main > div[class~="px-5"][class~="py-6"] {
                        padding: 0 !important;
                    }
                    #htmlContentIframe { display: block !important; border: 0 !important; }
                    #applyArea {
                        position: fixed !important;
                        inset: auto auto 12px 12px !important;
                        z-index: 100 !important;
                        width: fit-content !important;
                        max-width: calc(100% - 24px) !important;
                        padding: 0 !important;
                        background: none !important;
                        background-image: none !important;
                    }
                    #applyArea > div:not(#applyButtons) { display: none !important; }
                    #applyArea #applyButtons {
                        display: flex !important;
                        justify-content: flex-start !important;
                    }
                    #applyArea #applyButtons button, #applyArea #applyButtons a {
                        background-color: #c8102e !important;
                        color: #fff !important;
                    }
                ` : ''}
                ${site === 'pinokis' ? `
                    body { background: #fff !important; }
                    #main { padding: 0 !important; }
                    body > header, body > footer, #main > .wrapper > aside,
                    body > div.fixed.inset-0[class~="z-[70]"] {
                        display: none !important;
                    }
                    #content .jobs-bg { margin: 0 !important; }
                    #content .jobs-bg > .container {
                        width: 100% !important;
                        max-width: none !important;
                    }
                    #content .jobs-bg > .max-w-6xl {
                        width: 100% !important;
                        max-width: none !important;
                        margin: 0 !important;
                        padding: 12px !important;
                    }
                    #content .jobs-bg > .max-w-6xl > nav { display: none !important; }
                    #content .jobs-bg > .max-w-6xl > .grid {
                        grid-template-columns: minmax(0, 1fr) !important;
                    }
                    #content .jobs-bg > .max-w-6xl > .grid > [class~="lg:col-span-2"] {
                        grid-column: auto !important;
                    }
                ` : ''}
            `;
            doc.head.appendChild(previewStyle);
        }
        const chromeSelectors = {
            cvbankas: '#main_header',
            cvonline: '.page-header, .top-banner',
            cvmarket: 'body > header nav, body > div[class~="lg:container"] > nav',
            cvlt: 'body > header, a[href="/jobs"]',
            pinokis: 'body > header, body > footer, #main > .wrapper > aside',
            uzt: '#topbar, #wrapper > header, #wrapper > nav, .quick-access-nav, nav.sort-pages'
        };
        doc.querySelectorAll(chromeSelectors[site])
            .forEach(element => element.style.setProperty('display', 'none', 'important'));
        const details = getJobPreviewDetails(doc, site);
        if (!details) return;
        addSkillSelectionMenu(doc, details);
        if (site !== 'cvonline') {
            const selectedCard = getJobCards().find(card => getJobUrl(card) === selectedJobUrl);
            if (selectedCard) {
                const title = getJobPreviewTitle(selectedCard, details);
                updateJobPreviewTitle(title);
            }
        }
        if (site === 'uzt') {
            details.querySelectorAll(`
                nav, button, h1
            `).forEach(element => {
                if (element.parentElement === details || element.matches('nav')) {
                    element.style.setProperty('display', 'none', 'important');
                }
            });
            details.style.setProperty('padding-top', '0', 'important');
            doc.querySelector('#content .announcement-text')
                ?.closest('.entries')?.style.setProperty('display', 'none', 'important');
        }
        highlightSkills(details);
        highlightSalaries(details);
        if (site === 'cvlt') enhanceCvltDescriptionFrame(doc);
        if (!previewObservers.has(doc)) {
            const observer = new doc.defaultView.MutationObserver(() => {
                highlightSkills(details);
                highlightSalaries(details);
                if (site !== 'cvonline') {
                    const card = getJobCards().find(item => getJobUrl(item) === selectedJobUrl);
                    if (card) {
                        const title = getJobPreviewTitle(card, details);
                        updateJobPreviewTitle(title);
                    }
                }
            });
            observer.observe(details, { childList: true, characterData: true, subtree: true });
            previewObservers.set(doc, observer);
        }
    }

    function getJobUrl(card) {
        const site = getSite();
        if (site === 'cvbankas') return card.querySelector('.list_a[href]')?.href || '';
        if (site === 'cvonline') return card.querySelector('a[href*="/vacancy/"]')?.href || '';
        if (site === 'cvmarket') return card.querySelector('a.jobad-url[href]')?.href || '';
        if (site === 'cvlt') {
            const position = normalized(getJobDetails(card).position);
            return Array.from(card.querySelectorAll('a[href]'))
                .find(link => normalized(link.innerText) === position)?.href || '';
        }
        if (site === 'pinokis') return card.querySelector('h2 a[href*="/darbo-skelbimai/"]')?.href || '';
        if (site === 'uzt') return card.matches('a[href]') ? card.href : '';
        return '';
    }

    function getAppliedJobKey(card) {
        const site = getSite();
        if (!site || site === 'linkedin') return '';
        const href = getJobUrl(card);
        if (href) {
            return getAppliedJobKeyForUrl(href, site);
        }
        const { company, position } = getJobDetails(card);
        return position ? `${site}:${normalized(company)}:${normalized(position)}` : '';
    }

    function getAppliedJobKeyForUrl(href, site = getSite()) {
        const url = new URL(href, location.href);
        return `${site}:${url.origin}${url.pathname}`;
    }

    async function markPinokisAppliedFromConfirmation(doc) {
        if (getSite() !== 'pinokis' || !doc?.body
            || !includesListingText(doc.body.innerText, PINOKIS_APPLIED_CONFIRMATION)) return;
        const docUrl = new URL(doc.defaultView.location.href);
        const vacancyUrl = /^\/darbo-skelbimai\/\d+(?:\/|$)/.test(docUrl.pathname)
            ? docUrl.href
            : (doc === document || doc === jobPreviewFrame?.contentDocument) ? selectedJobUrl : '';
        if (!vacancyUrl) return;
        const key = getAppliedJobKeyForUrl(vacancyUrl, 'pinokis');
        if (settings.appliedJobs.includes(key) || pinokisAppliedConfirmationDocuments.has(doc)) return;
        pinokisAppliedConfirmationDocuments.add(doc);
        settings.appliedJobs.push(key);
        if (!await saveSettings()) {
            const addedIndex = settings.appliedJobs.indexOf(key);
            if (addedIndex >= 0) settings.appliedJobs.splice(addedIndex, 1);
            setStatus('CV upload succeeded, but the applied marker could not be saved.');
            return;
        }
        getJobCards().filter(card => getAppliedJobKey(card) === key)
            .forEach(card => {
                const checkbox = card.querySelector('.li-tools-applied-checkbox');
                if (checkbox) checkbox.checked = true;
            });
        setStatus('Pinokis CV upload confirmed; vacancy marked as applied.');
        applyFilter();
    }

    function observePinokisAppliedConfirmation(doc) {
        if (getSite() !== 'pinokis' || !doc?.body) return;
        markPinokisAppliedFromConfirmation(doc).catch(error => {
            console.error('Job Search Toolkit: could not process the Pinokis CV confirmation.', error);
        });
        if (pinokisAppliedConfirmationObservers.has(doc)) return;
        const observer = new doc.defaultView.MutationObserver(() => {
            markPinokisAppliedFromConfirmation(doc).catch(error => {
                console.error('Job Search Toolkit: could not process the Pinokis CV confirmation.', error);
            });
        });
        observer.observe(doc.body, { childList: true, characterData: true, subtree: true });
        pinokisAppliedConfirmationObservers.add(doc);
    }

    function previewUrlFromHash() {
        return new URLSearchParams(location.hash.slice(1)).get('li-job-tools-job') || '';
    }

    function setSelectedJobUrlInHistory(href) {
        const url = new URL(location.href);
        const params = new URLSearchParams(url.hash.slice(1));
        params.set('li-job-tools-job', href);
        url.hash = params.toString();
        const state = Object.assign({}, history.state || {}, { liJobToolsSplit: true, liJobToolsJob: href });
        if (history.state?.liJobToolsSplit) history.replaceState(state, '', url.href);
        else history.pushState(state, '', url.href);
    }

    function clearSelectedJobUrlFromHistory() {
        const params = new URLSearchParams(location.hash.slice(1));
        params.delete('li-job-tools-job');
        const url = new URL(location.href);
        url.hash = params.toString();
        history.replaceState(Object.assign({}, history.state || {}, { liJobToolsSplit: false }), '', url.href);
    }

    function updateSelectedJobCard() {
        getJobCards().forEach(card => {
            card.classList.toggle('li-tools-job-selected', !!selectedJobUrl && getJobUrl(card) === selectedJobUrl);
        });
    }

    function updateJobPreviewTitle(fields) {
        const title = Object.values(fields).filter(Boolean).join(' | ') || 'Job details';
        if (jobPreviewFrame.title !== title) jobPreviewFrame.title = title;
        if (jobPreviewTitle.dataset.title !== title) {
            jobPreviewTitle.dataset.title = title;
            jobPreviewTitle.replaceChildren();
            const icons = {
                position: 'M20 6h-3V4a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zM9 4h6v2H9zm11 14H4V8h16z',
                company: 'M12 3 2 8v13h20V8zm-1 16H7v-4h4zm0-6H7V9h4zm6 6h-4v-4h4zm0-6h-4V9h4z',
                location: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
                salary: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 16.9V20h-2v-1.1c-1.7-.3-3-1.3-3.1-3.1h2c.1.9.8 1.4 2.1 1.4 1.1 0 1.8-.5 1.8-1.2 0-.8-.7-1.1-2.2-1.5-2-.5-3.5-1.2-3.5-3.2 0-1.6 1.2-2.7 2.9-3V7h2v1.2c1.6.3 2.6 1.4 2.7 3h-2c-.1-.9-.7-1.3-1.8-1.3-1 0-1.6.4-1.6 1.1 0 .7.6 1 2.1 1.4 2.1.5 3.6 1.2 3.6 3.3 0 1.6-1.2 2.9-3 3.2z'
            };
            for (const [kind, value] of Object.entries(fields)) {
                if (!value) continue;
                const interactive = kind === 'position' || kind === 'company';
                const pill = document.createElement(interactive ? 'button' : 'span');
                if (interactive) {
                    pill.type = 'button';
                    pill.className = 'li-tools-title-pill';
                    pill.dataset.titleKind = kind;
                    pill.setAttribute('aria-label', `${kind[0].toUpperCase()}${kind.slice(1)}: ${value}. Open blocking actions.`);
                } else {
                    pill.className = 'li-tools-title-label';
                    pill.setAttribute('role', 'group');
                    pill.setAttribute('aria-label', `${kind[0].toUpperCase()}${kind.slice(1)}: ${value}`);
                }
                pill.dataset.titleValue = value;
                pill.title = `${kind[0].toUpperCase()}${kind.slice(1)}: ${value}`;
                const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                icon.setAttribute('viewBox', '0 0 24 24');
                icon.setAttribute('aria-hidden', 'true');
                icon.classList.add('li-tools-title-icon');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', icons[kind]);
                icon.appendChild(path);
                pill.append(icon, document.createTextNode(value));
                jobPreviewTitle.appendChild(pill);
            }
        }
    }

    function showJobTitleMenu(event, kind, value, trigger) {
        document.querySelector('.li-tools-title-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'li-tools-title-menu';
        menu.setAttribute('role', 'group');
        menu.setAttribute('aria-label', 'Blocking actions');
        menu.dataset.liJobTools = '1';
        const options = kind === 'phrase'
            ? [['Block phrase...', () => openBlockValueDialog(value, 'phrase'), false]]
            : kind === 'position'
                ? [['Block position...', () => openBlockValueDialog(value, 'position'), false]]
                : [['Block employer', () => {
                const card = getJobCards().find(item => getJobUrl(item) === selectedJobUrl);
                if (card) addBlock(card, 'employer');
            }, true]];
        options.forEach(([label, action, restoreFocus]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', () => {
                menu.remove();
                action();
                if (restoreFocus) trigger?.focus();
            });
            menu.appendChild(button);
        });
        const left = Math.max(8, Math.min(event.clientX, window.innerWidth - 200));
        const top = Math.max(8, Math.min(event.clientY, window.innerHeight - 80));
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        document.body.appendChild(menu);
        menu.querySelector('button').focus();
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('pointerdown', closeOnOutside, true);
        };
        const closeOnOutside = pointerEvent => {
            if (!menu.contains(pointerEvent.target)) closeMenu();
        };
        menu.addEventListener('keydown', keyEvent => {
            if (keyEvent.key === 'Escape') {
                closeMenu();
                trigger?.focus();
            }
        });
        document.addEventListener('pointerdown', closeOnOutside, true);
        menu.querySelector('button').addEventListener('click', () => {
            document.removeEventListener('pointerdown', closeOnOutside, true);
        }, { once: true });
    }

    function setupJobTitleActions() {
        jobPreviewTitle.addEventListener('contextmenu', event => {
            const selection = window.getSelection();
            const selectedText = selection?.toString().trim();
            const anchor = selection?.anchorNode;
            const selectionInTitle = anchor && jobPreviewTitle.contains(anchor.nodeType === Node.ELEMENT_NODE
                ? anchor : anchor.parentElement);
            if (selectedText && selectionInTitle) {
                event.preventDefault();
                showJobTitleMenu(event, 'phrase', selectedText, null);
                return;
            }
            const pill = event.target.closest('.li-tools-title-pill');
            if (!pill) return;
            event.preventDefault();
            showJobTitleMenu(event, pill.dataset.titleKind, pill.dataset.titleValue, pill);
        });
    }

    function openJobPreview(card, href, updateHistory = true) {
        let url;
        try {
            url = new URL(href, location.href);
        } catch (error) {
            console.warn('Job Search Toolkit: could not open the selected vacancy URL.', error);
            return;
        }
        if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
        selectedJobUrl = url.href;
        updateJobPreviewTitle(getJobPreviewTitle(card));
        jobPreview.hidden = false;
        if (jobPreviewFrame.src !== url.href) {
            jobPreviewFrame.setAttribute('aria-busy', 'true');
            jobPreviewFrame.src = url.href;
        } else enhanceJobPreviewFrame();
        updateSelectedJobCard();
        if (updateHistory) setSelectedJobUrlInHistory(url.href);
    }

    function closeJobPreview(updateHistory = true) {
        const previousUrl = selectedJobUrl;
        selectedJobUrl = '';
        if (jobPreview) {
            jobPreview.hidden = true;
            jobPreviewFrame.src = 'about:blank';
            jobPreviewFrame.removeAttribute('aria-busy');
        }
        updateSelectedJobCard();
        if (updateHistory && previewUrlFromHash()) clearSelectedJobUrlFromHistory();
        if (previousUrl) {
            const card = getJobCards().find(item => getJobUrl(item) === previousUrl);
            card?.querySelector('a[href]')?.focus();
        }
    }

    function syncJobPreviewWithLocation() {
        const href = previewUrlFromHash();
        if (!href) {
            closeJobPreview(false);
            return;
        }
        const card = getJobCards().find(item => getJobUrl(item) === href);
        if (card) openJobPreview(card, href, false);
    }

    function setupJobPreview() {
        const site = getSite();
        if (!splitViewSites.has(site)) return;
        const cards = getJobCards();
        if (!window.matchMedia('(min-width: 1200px)').matches || !cards.length) {
            document.body.classList.remove('li-tools-split-view');
            return;
        }
        document.body.classList.add('li-tools-split-view');
        document.body.dataset.liToolsSite = site;
        if (!jobPreview) {
            jobPreview = document.createElement('aside');
            jobPreview.id = 'li-tools-job-preview';
            jobPreview.hidden = true;
            jobPreview.setAttribute('aria-label', 'Selected job details');
            jobPreview.dataset.liJobTools = '1';
            const header = document.createElement('div');
            header.id = 'li-tools-job-preview-header';
            jobPreviewTitle = document.createElement('h2');
            jobPreviewTitle.id = 'li-tools-job-preview-title';
            jobPreviewTitle.dataset.title = '';
            setupJobTitleActions();
            const closeButton = document.createElement('button');
            closeButton.id = 'li-tools-job-preview-close';
            closeButton.type = 'button';
            closeButton.textContent = 'Close';
            closeButton.addEventListener('click', () => closeJobPreview());
            jobPreviewFrame = document.createElement('iframe');
            jobPreviewFrame.id = 'li-tools-job-preview-frame';
            jobPreviewFrame.title = 'Selected job details';
            jobPreviewFrame.addEventListener('load', () => {
                jobPreviewFrame.removeAttribute('aria-busy');
                enhanceJobPreviewFrame();
                jobPreviewFrame.contentWindow.scrollTo(0, 0);
                setTimeout(() => {
                    enhanceJobPreviewFrame();
                    jobPreviewFrame.contentWindow.scrollTo(0, 0);
                }, 300);
            });
            header.append(jobPreviewTitle, closeButton);
            jobPreview.append(header, jobPreviewFrame);
            document.body.appendChild(jobPreview);
            syncJobPreviewWithLocation();
        }
    }

    document.addEventListener('click', event => {
        if (!window.matchMedia('(min-width: 1200px)').matches || !splitViewSites.has(getSite())
            || !(event.target instanceof Element) || event.target.closest('[data-li-job-tools]')) return;
        const target = event.target;
        if (target.closest('button, input, select, textarea')) return;
        const card = getJobCards().find(item => item === target || item.contains(target));
        if (!card) return;
        const href = getJobUrl(card);
        if (!href) return;
        const link = target.closest('a[href]');
        if (link && link.href !== href) return;
        event.preventDefault();
        event.stopPropagation();
        openJobPreview(card, href);
    }, true);

    window.addEventListener('popstate', syncJobPreviewWithLocation);
    window.addEventListener('hashchange', syncJobPreviewWithLocation);

    function applyFilter() {
        const site = getSite();
        const cards = getJobCards();
        const visibleCards = new Map();
        cards.forEach(card => {
            ensureCardBlockMenu(card);
            const job = card.querySelector('div.job-card-container[data-job-id]') || card;
            const text = job.innerText.toLowerCase();
            const { company, position } = getJobDetails(card);
            const isPromoted = !!job.querySelector('.job-card-container__footer-item--highlighted')
                || /\b(?:promoted|vip|premium)\b/i.test(text);
            const isViewed = text.includes('viewed');
            const hiddenKey = site !== 'linkedin' ? getAppliedJobKey(card) : '';
            const isHidden = hiddenNoticePattern.test(job.textContent || '')
                || (!!hiddenKey && settings.hiddenJobs.includes(hiddenKey));
            const isApplied = text.includes('applied')
                || (site !== 'linkedin' && settings.appliedJobs.includes(getAppliedJobKey(card)));
            const isActive = job.getAttribute('aria-current') === 'page';
            const blocked = settings.blockedPhrases.some(phrase => includesListingText(text, phrase))
                || settings.blockedEmployers.some(employer =>
                    normalized(company) === normalized(employer) || includesListingText(text, employer)
                )
                || settings.blockedPositions.some(blockedPosition =>
                    normalized(position) === normalized(blockedPosition) || includesListingText(text, blockedPosition)
                )
                || settings.blockedEmployerPositions.some(item =>
                    (normalized(company) === normalized(item.company) && normalized(position) === normalized(item.position))
                    || (includesListingText(text, item.company) && includesListingText(text, item.position))
                );
            let visible = !blocked && salaryMeetsFilter(card);
            if (settings.onlyUnviewed && isViewed && !isActive) visible = false;
            if (settings.onlyUnhidden && isHidden) visible = false;
            if (settings.onlyUnapplied && isApplied) visible = false;
            if (settings.activeFilter === FILTERS.SHOW_PROMOTED) visible = visible && isPromoted;
            if (settings.activeFilter === FILTERS.SHOW_NORMAL) visible = visible && !isPromoted;
            card.classList.toggle('li-tools-filtered-out', !visible);
            visibleCards.set(card, visible);
            if (site === 'uzt') {
                if (visible) card.style.removeProperty('display');
                else card.style.setProperty('display', 'none', 'important');
            }
            card.classList.toggle('li-tools-job-selected', !!selectedJobUrl && getJobUrl(card) === selectedJobUrl);
        });
        const selectedIndex = cards.findIndex(card => getJobUrl(card) === selectedJobUrl);
        if (selectedJobUrl && selectedIndex >= 0 && !visibleCards.get(cards[selectedIndex])) {
            const nextCard = [...cards.slice(selectedIndex + 1), ...cards.slice(0, selectedIndex)]
                .find(card => visibleCards.get(card) && getJobUrl(card));
            if (nextCard) openJobPreview(nextCard, getJobUrl(nextCard));
        }
        scheduleEmptyResultsPagination(cards, visibleCards);
    }

    function paginationBaseUrl() {
        const url = new URL(location.href);
        for (const key of ['page', 'pageNumber', 'page_number', 'pageIndex', 'offset', 'start', 'p']) {
            url.searchParams.delete(key);
        }
        const hash = new URLSearchParams(url.hash.slice(1));
        hash.delete('li-job-tools-job');
        url.hash = hash.toString();
        return url.href;
    }

    function getAutoPaginationState(base) {
        try {
            const state = JSON.parse(sessionStorage.getItem(AUTO_PAGINATION_KEY) || 'null');
            return state?.base === base && Array.isArray(state.attemptedPages) && Array.isArray(state.visitedUrls)
                ? state : null;
        } catch (error) {
            console.warn('Job Search Toolkit: could not read auto-pagination state.', error);
            return null;
        }
    }

    function setAutoPaginationState(state) {
        try {
            sessionStorage.setItem(AUTO_PAGINATION_KEY, JSON.stringify(state));
            return true;
        } catch (error) {
            console.error('Job Search Toolkit: could not save auto-pagination state.', error);
            return false;
        }
    }

    function clearAutoPaginationState() {
        try {
            sessionStorage.removeItem(AUTO_PAGINATION_KEY);
        } catch (error) {
            console.warn('Job Search Toolkit: could not clear auto-pagination state.', error);
        }
    }

    function findNextPageControl() {
        const pagination = Array.from(document.querySelectorAll(
            'nav[aria-label*="pagination" i], [class*="pagination" i], [id*="pagination" i], [aria-label*="pagination" i], nav, [role="navigation"], ul, mat-paginator'
        ));
        const controls = Array.from(new Set([
            ...document.querySelectorAll('a[rel~="next" i], button[rel~="next" i]'),
            ...pagination.flatMap(container => Array.from(container.querySelectorAll('a[href], button')))
        ]));
        const nextLabel = /^(?:next(?:\s+page)?|kitas(?:\s+puslapis)?|toliau|sekantis(?:\s+puslapis)?|pirmyn)$/i;
        const nextControl = controls.find(control => {
            if (!control.getClientRects().length || control.matches(':disabled, [aria-disabled="true"]')
                || control.closest('[aria-disabled="true"], .disabled, .is-disabled')) return false;
            const href = control instanceof HTMLAnchorElement ? control.href : '';
            if (href && (!/^https?:$/.test(new URL(href).protocol) || new URL(href).origin !== location.origin)) return false;
            const labels = [
                control.getAttribute('aria-label'),
                control.getAttribute('title'),
                control.innerText
            ].filter(Boolean).map(label => label.trim());
            return control.relList?.contains('next')
                || labels.some(label => nextLabel.test(label))
                || (labels.some(label => /^(?:›|»|→|⟩|>)$/.test(label))
                    && pagination.some(container => container.contains(control)));
        });
        if (nextControl) return nextControl;

        for (const container of pagination) {
            const current = Array.from(container.querySelectorAll(
                '[aria-current="page"], [aria-disabled="true"], .active, .current, .selected, [class*="bg-brand"]'
            )).find(element => /^\d+$/.test(element.textContent.trim()));
            if (!current) continue;
            const currentPage = Number(current.textContent.trim());
            const numberedNext = Array.from(container.querySelectorAll('a[href], button')).find(control =>
                control.textContent.trim() === String(currentPage + 1)
                && control.getClientRects().length
                && !control.matches(':disabled, [aria-disabled="true"]')
                && !control.closest('[aria-disabled="true"], .disabled, .is-disabled')
                && (!(control instanceof HTMLAnchorElement) || new URL(control.href).origin === location.origin)
            );
            if (numberedNext) return numberedNext;
        }
    }

    function closeEmptyResultsPreview() {
        if (selectedJobUrl) closeJobPreview();
    }

    function scheduleEmptyResultsPagination(cards, visibleCards) {
        clearTimeout(autoPaginationTimer);
        const visible = cards.filter(card => visibleCards.get(card));
        const base = paginationBaseUrl();
        const state = getAutoPaginationState(base);
        if (visible.length) {
            if (state) {
                clearAutoPaginationState();
                attemptedPaginationPages.clear();
                if (splitViewSites.has(getSite()) && window.matchMedia('(min-width: 1200px)').matches) {
                    const firstResult = visible.find(card => getJobUrl(card));
                    if (firstResult) openJobPreview(firstResult, getJobUrl(firstResult));
                }
            }
            return;
        }
        if (!getSite()) return;
        autoPaginationTimer = setTimeout(() => {
            const currentCards = getJobCards();
            if (currentCards.some(card => !card.classList.contains('li-tools-filtered-out'))) {
                scheduleEmptyResultsPagination(currentCards, new Map(currentCards.map(card => [
                    card, !card.classList.contains('li-tools-filtered-out')
                ])));
                return;
            }
            const currentBase = paginationBaseUrl();
            let currentState = getAutoPaginationState(currentBase)
                || { base: currentBase, attemptedPages: [], visitedUrls: [] };
            const activePage = document.querySelector(
                'nav[aria-label*="pagination" i] [aria-current="page"], [class*="pagination" i] [aria-current="page"], [class*="pagination" i] .active'
            )?.textContent.trim() || '';
            const pageKey = `${location.href}|${activePage}|${currentCards.map(getJobUrl).join('|')}`;
            if (currentState.attemptedPages.includes(pageKey) || attemptedPaginationPages.has(pageKey)) return;
            const next = findNextPageControl();
            if (!next) {
                clearAutoPaginationState();
                attemptedPaginationPages.clear();
                closeEmptyResultsPreview();
                return;
            }
            const nextUrl = next instanceof HTMLAnchorElement ? next.href : '';
            if (nextUrl && currentState.visitedUrls.includes(nextUrl)) {
                clearAutoPaginationState();
                closeEmptyResultsPreview();
                return;
            }
            currentState.attemptedPages.push(pageKey);
            currentState.visitedUrls.push(location.href);
            if (nextUrl) currentState.visitedUrls.push(nextUrl);
            attemptedPaginationPages.add(pageKey);
            if (setAutoPaginationState(currentState)) next.click();
        }, 500);
    }

    function unwrapHighlights(root, selector) {
        const ownerDocument = root.ownerDocument;
        root.querySelectorAll(selector).forEach(span => {
            const contents = ownerDocument.createDocumentFragment();
            while (span.firstChild) contents.appendChild(span.firstChild);
            span.replaceWith(contents);
        });
    }

    function replaceTextNodes(root, matcher, createHighlight, validMatch = () => true) {
        const ownerDocument = root.ownerDocument;
        const nodeFilter = ownerDocument.defaultView.NodeFilter;
        const walker = ownerDocument.createTreeWalker(root, nodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return node.parentElement?.closest('script, style, button, input, textarea, select, option, [data-li-job-tools], .li-tools-salary-highlight') ?
                    nodeFilter.FILTER_REJECT : nodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        let replacementCount = 0;
        let precedingText = '';
        let node;
        while ((node = walker.nextNode())) nodes.push(node);
        for (const textNode of nodes) {
            const text = textNode.textContent || '';
            const matches = Array.from(text.matchAll(new RegExp(matcher.source, matcher.flags)))
                .filter(match => validMatch(match, text));
            if (!matches.length) {
                precedingText = (precedingText + text).slice(-100);
                continue;
            }
            const fragment = ownerDocument.createDocumentFragment();
            let lastIndex = 0;
            for (const match of matches) {
                const start = match.index;
                if (start < lastIndex) continue;
                if (start > lastIndex) fragment.appendChild(ownerDocument.createTextNode(text.slice(lastIndex, start)));
                fragment.appendChild(createHighlight(
                    match[0],
                    (precedingText + text.slice(0, start)).slice(-100),
                    text.slice(start + match[0].length, start + match[0].length + 100)
                ));
                replacementCount++;
                lastIndex = start + match[0].length;
            }
            precedingText = (precedingText + text).slice(-100);
            if (lastIndex === 0) continue;
            if (lastIndex < text.length) fragment.appendChild(ownerDocument.createTextNode(text.slice(lastIndex)));
            textNode.parentNode.replaceChild(fragment, textNode);
        }
        return replacementCount;
    }

    function contrastingText(color) {
        const channels = color.match(/[\da-f]{2}/gi).map(channel => parseInt(channel, 16) / 255);
        const luminance = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2)
            .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
        return luminance > 0.179 ? '#000000' : '#ffffff';
    }

    function highlightSkills(root) {
        if (!root) return;
        const text = root.textContent || '';
        const signature = `${settings.skillsEnabled}\u0000${JSON.stringify(settings.skills)}\u0000${text}`;
        const previous = skillSignature.get(root);
        const currentCount = root.querySelectorAll('.li-tools-skill-highlight').length;
        if (previous?.signature === signature && previous.count === currentCount) return;
        unwrapHighlights(root, '.li-tools-skill-highlight');
        let count = 0;
        if (settings.skillsEnabled && settings.skills.length) {
            const skills = settings.skills.slice().sort((first, second) => second.name.length - first.name.length);
            const skillByName = new Map(skills.map(skill => [skill.name.toLowerCase(), skill]));
            const matcher = new RegExp(skills.map(skill => skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');
            count = replaceTextNodes(root, matcher, value => {
                const span = root.ownerDocument.createElement('span');
                const skill = skillByName.get(value.toLowerCase());
                span.className = 'li-tools-skill li-tools-skill-highlight';
                span.style.backgroundColor = skill.color;
                span.style.color = contrastingText(skill.color);
                span.textContent = value;
                return span;
            }, (match, content) => {
                const before = content[match.index - 1] || '';
                const after = content[match.index + match[0].length] || '';
                return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
            });
        }
        skillSignature.set(root, { signature, count });
    }

    const salaryNumberPattern = String.raw`\d[\d \u00a0\u202f.,]*(?:[kKmM])?`;
    const salaryCurrencyPattern = '(?:€|\\$|£|¥|₹|₽|₩|₺|₫|₪|₱|₦|₴|₡|₲|₵|฿|\\b(?:EUR|USD|GBP|CAD|AUD|NZD|CHF|JPY|CNY|INR|RUB|KRW|PLN|SEK|NOK|DKK|ISK|CZK|HUF|RON|BGN|TRY|BRL|MXN|ZAR|AED|SAR|ILS|THB|IDR|PHP|VND|SGD|HKD|ARS|CLP|COP|PEN|UYU|UAH|KZT|GEL|AMD|AZN|PKR|BDT|LKR|NPR|KES|EGP|NGN|GHS|MAD|TWD|MYR|BHD|KWD|OMR|QAR|JOD)\\b)';
    const salaryCurrencyAmountPattern = `(?:${salaryCurrencyPattern}\\s*${salaryNumberPattern}|${salaryNumberPattern}\\s*${salaryCurrencyPattern})`;
    const salaryRangeConnector = '(?:-|–|—|to|iki)';
    const salaryPeriodPattern = String.raw`(?:\/|per\s*)?\s*(?:hour|hr|h|val\.?|month|mo|year|yr|annum|week|wk|day|daily|m[eė]n\.?)`;
    const HOURS_PER_MONTH = 160;
    const salaryUnqualifiedAmountPattern = `(?:${salaryCurrencyAmountPattern}|${salaryNumberPattern})`;
    const salaryRangePattern = `(?:${salaryCurrencyAmountPattern}(?:\\s*${salaryPeriodPattern})?\\s*${salaryRangeConnector}\\s*${salaryUnqualifiedAmountPattern}(?:\\s*${salaryPeriodPattern})?|${salaryNumberPattern}(?:\\s*${salaryPeriodPattern})?\\s*${salaryRangeConnector}\\s*${salaryCurrencyAmountPattern}(?:\\s*${salaryPeriodPattern})?|${salaryCurrencyAmountPattern}|${salaryNumberPattern}(?:\\s*${salaryPeriodPattern})?\\s*${salaryRangeConnector}\\s*${salaryNumberPattern}(?:\\s*${salaryPeriodPattern})?)`;
    const salaryMatcher = new RegExp(
        `(?:(?:from|nuo)\\s*)?${salaryRangePattern}(?:\\s*${salaryPeriodPattern})?`,
        'gi'
    );
    function parseSalaryNumber(value) {
        const compact = value.replace(/\s/g, '');
        const multiplier = /m$/i.test(compact) ? 1000000 : /k$/i.test(compact) ? 1000 : 1;
        const raw = compact.replace(/[kKmM]$/, '').replace(/[^\d.,]/g, '');
        const lastSeparator = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
        const digitsAfterSeparator = lastSeparator < 0 ? 0 : raw.length - lastSeparator - 1;
        let numberText;
        if (raw.includes('.') && raw.includes(',')) {
            const decimalSeparator = lastSeparator;
            numberText = raw.slice(0, decimalSeparator).replace(/[.,]/g, '') + '.' + raw.slice(decimalSeparator + 1);
        } else if (digitsAfterSeparator > 0 && digitsAfterSeparator !== 3) {
            numberText = raw.slice(0, lastSeparator).replace(/[.,]/g, '') + '.' + raw.slice(lastSeparator + 1);
        } else {
            numberText = raw.replace(/[.,]/g, '');
        }
        const amount = Number(numberText) * multiplier;
        return Number.isFinite(amount) ? amount : 0;
    }

    function monthlySalaryRange(match, precedingText = '', followingText = '') {
        const values = Array.from(match.matchAll(new RegExp(salaryNumberPattern, 'gi')), item => parseSalaryNumber(item[0]))
            .filter(value => value > 0);
        if (!values.length) return null;
        const context = `${precedingText} ${followingText}`;
        const period = /hour|\/h\b|\/hr|\bhr\b|val\.?/i.test(match) ? HOURS_PER_MONTH
            : /week|\/wk|\bwk\b/i.test(match) ? 52 / 12
                : /daily|day|\/day/i.test(match) ? 260 / 12
                    : /year|\/yr|\byr\b|annum/i.test(match)
                        || /\bannual(?:ly)?\b|\byearly\b|\bper year\b/i.test(context) ? 1 / 12 : 1;
        return [Math.min(...values) * period, Math.max(...values) * period];
    }

    const salaryContextPattern = /\b(?:salary|pay|wage|income|monthly|hourly|yearly|annual|nuo|atlygin\w*|užmok\w*)\b/i;
    const explicitSalaryPeriodPattern = new RegExp(salaryPeriodPattern, 'i');
    const hasCurrencyPattern = new RegExp(salaryCurrencyPattern, 'i');

    function isSalaryMatch(value, precedingText = '', followingText = '') {
        return hasCurrencyPattern.test(value)
            || explicitSalaryPeriodPattern.test(value)
            || salaryContextPattern.test(`${precedingText.slice(-60)} ${followingText.slice(0, 60)}`);
    }

    function getJobPreviewTitle(card, details) {
        const { position, company } = getJobDetails(card);
        const roots = [details, card].filter(Boolean);
        const locationSelector = '[itemprop="jobLocation"], [data-testid*="location" i], [class*="location" i], [class*="city" i], [class*="place" i]';
        let location = '';
        if (getSite() === 'cvonline') {
            const listingLines = card.innerText.split('\n').map(line => line.trim()).filter(Boolean);
            const companyLocation = listingLines.find(line => line.includes('/') && /\s+[—–-]\s+/.test(line));
            if (companyLocation) location = companyLocation.split(/\s+[—–-]\s+/).slice(1).join(' — ');
        }
        if (getSite() === 'pinokis') {
            const locationLink = Array.from(card.querySelectorAll('a[href*="/darbas-"]'))
                .find(link => link.querySelector('.mi'));
            location = locationLink?.innerText.split('\n').map(line => line.trim())
                .map(line => line.replace(/^(?:place|location_on)\s+/i, ''))
                .filter(line => line && !/^(?:place|location_on)$/i.test(line)).join(' ') || '';
        }
        for (const root of location ? [] : roots) {
            const candidates = Array.from(root.querySelectorAll(locationSelector))
                .map(element => element.innerText.trim().replace(/\s+/g, ' '))
                .filter(value => value && value.length <= 100 && !/^(?:location|city|place|miestas|darbo vieta)$/i.test(value))
                .sort((left, right) => left.length - right.length);
            if (candidates.length) {
                location = candidates[0];
                break;
            }
            const lines = root.innerText.split('\n').map(line => line.trim()).filter(Boolean);
            const labelPattern = /^(?:location|city|place|miestas|miesto|darbo vieta)\s*:?\s*/i;
            const locationLine = lines.findIndex(line => /^(?:location|city|place|miestas|miesto|darbo vieta)\s*:/i.test(line));
            const labelIndex = lines.findIndex(line => /^(?:location|city|place|miestas|miesto|darbo vieta)$/i.test(line));
            const labelLine = locationLine >= 0 ? lines[locationLine].replace(labelPattern, '')
                : labelIndex >= 0 ? lines[labelIndex + 1] || '' : '';
            if (labelLine) {
                location = labelLine;
                break;
            }
        }

        const salarySelector = '.salary-label, .salary_text, [data-component="badge"], [class*="salary" i], [data-testid*="salary" i]';
        const salaryRoots = roots.flatMap(root => {
            const elements = Array.from(root.querySelectorAll(salarySelector));
            return elements.length ? elements : [root];
        });
        let salary = '';
        for (const root of salaryRoots) {
            const lines = root.innerText.split('\n').map(line => line.trim()).filter(Boolean);
            for (const line of lines) {
                const match = Array.from(line.matchAll(new RegExp(salaryMatcher.source, salaryMatcher.flags)))
                    .find(item => isSalaryMatch(item[0], line.slice(0, item.index), line.slice(item.index + item[0].length)));
                if (match) {
                    salary = match[0].trim();
                    break;
                }
            }
            if (salary) break;
        }
        return { position, company, location, salary };
    }

    function salaryMeetsFilter(card) {
        if (settings.salaryMinimum <= 0) return true;
        const salaryFloor = settings.salaryMinimum * (1 - SALARY_FILTER_TOLERANCE);
        const site = getSite();
        const salaryText = site === 'cvonline' ? card.querySelector('.salary-label')?.innerText || ''
            : site === 'cvbankas' ? card.querySelector('.salary_text')?.innerText || ''
                : site === 'cvlt' ? Array.from(card.querySelectorAll('[data-component="badge"]'))
                    .map(badge => badge.innerText)
                    .find(text => new RegExp(salaryCurrencyPattern, 'i').test(text)) || ''
                : card.innerText;
        const lines = salaryText.split('\n').map(line => line.trim()).filter(Boolean);
        const bareWorkInLithuaniaRange = /^\d[\d .,]*\s*(?:-|–|—|to)\s*\d[\d .,]*$/i;
        let hasSalaryRange = false;
        for (const line of lines) {
            if (site === 'workinlithuania' && bareWorkInLithuaniaRange.test(line)) {
                const range = monthlySalaryRange(line);
                if (range) {
                    hasSalaryRange = true;
                    if (range[1] >= salaryFloor) return true;
                }
                continue;
            }
            for (const match of line.matchAll(new RegExp(salaryMatcher.source, salaryMatcher.flags))) {
                const precedingText = line.slice(0, match.index);
                const followingText = line.slice(match.index + match[0].length);
                if (!isSalaryMatch(match[0], precedingText, followingText)) continue;
                const range = monthlySalaryRange(match[0], precedingText, followingText);
                if (!range) continue;
                hasSalaryRange = true;
                if (range[1] >= salaryFloor) return true;
            }
        }
        return !hasSalaryRange;
    }

    function setSearchControlValue(control, value) {
        if (!control) return false;
        if (control.value !== value) {
            const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), 'value')?.set;
            if (valueSetter) valueSetter.call(control, value);
            else control.value = value;
            control.dispatchEvent(new Event('input', { bubbles: true }));
            control.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return true;
    }

    function setNamedSearchControl(form, name, value) {
        const control = Array.from(form.elements).find(element => element.name === name);
        if (setSearchControlValue(control, value)) return;
        console.warn(`Job Search Toolkit: could not find the ${name} salary search field.`);
    }

    function applyNativeSalarySearch(form, site = getSite()) {
        if (settings.salaryMinimum <= 0) return;
        const salaryFloor = String(Math.floor(settings.salaryMinimum * (1 - SALARY_FILTER_TOLERANCE)));
        if (site === 'pinokis') {
            const control = form.querySelector('select[name="salary"]');
            if (!control || Number(control.value) >= Number(salaryFloor)) return;
            const option = Array.from(control.options)
                .filter(item => Number(item.value) > 0 && Number(item.value) <= Number(salaryFloor))
                .sort((first, second) => Number(second.value) - Number(first.value))[0];
            if (option) setSearchControlValue(control, option.value);
            return;
        }
        if (site === 'cvlt') {
            if (!form.querySelector('[name="search[keyword]"]')) return;
            const searchParams = new URL(location.href).searchParams;
            for (const name of ['dir', 'sort']) {
                if (Array.from(form.elements).some(element => element.name === name)) continue;
                const value = searchParams.get(name);
                if (value === null) continue;
                const control = document.createElement('input');
                control.type = 'hidden';
                control.name = name;
                control.value = value;
                form.appendChild(control);
            }
            for (const [name, value] of [['search[salary]', salaryFloor], ['search[job_salary]', '3']]) {
                let control = Array.from(form.elements).find(element => element.name === name);
                if (!control) {
                    control = document.createElement('input');
                    control.type = 'hidden';
                    control.name = name;
                    form.appendChild(control);
                }
                control.value = value;
            }
        }
        if (site === 'cvbankas') {
            if (!form.querySelector('[name="min_salary"]')) return;
            setNamedSearchControl(form, 'min_salary', salaryFloor);
        }
        if (site === 'cvonline') {
            if (!form.querySelector('[name="salaryFrom"]')) return;
            setNamedSearchControl(form, 'salaryFrom', salaryFloor);
            setNamedSearchControl(form, 'ratePer', 'MONTHLY');
        }
        if (site === 'cvmarket') {
            if (!form.querySelector('[name="search[salary]"]')) return;
            setNamedSearchControl(form, 'search[salary]', salaryFloor);
            setNamedSearchControl(form, 'search[job_salary]', '3');
        }
        if (site === 'uzt') {
            if (!form.querySelector('common-decimal-input[name="salaryFrom"]')) return;
            const salaryInput = form.querySelector('common-decimal-input[name="salaryFrom"] input');
            if (!setSearchControlValue(salaryInput, salaryFloor)) {
                console.warn('Job Search Toolkit: could not find the UZT salary search field.');
            }
            const checkboxes = Array.from(form.querySelectorAll('input[type="checkbox"]'));
            const monthly = checkboxes.find(input => /mėnesinis/i.test(input.closest('label')?.innerText || ''));
            const hourly = checkboxes.find(input => /valandinis/i.test(input.closest('label')?.innerText || ''));
            if (!monthly || !hourly) console.warn('Job Search Toolkit: could not identify the UZT salary period controls.');
            if (monthly && !monthly.checked) monthly.click();
            if (hourly?.checked) hourly.click();
        }
    }

    document.addEventListener('submit', event => {
        if (event.target instanceof HTMLFormElement) applyNativeSalarySearch(event.target);
    }, true);

    document.addEventListener('click', event => {
        const site = getSite();
        if (settings.salaryMinimum <= 0 || !(event.target instanceof Element)) return;
        const button = event.target.closest('button');
        if (!button) return;
        const salaryFloor = String(Math.floor(settings.salaryMinimum * (1 - SALARY_FILTER_TOLERANCE)));
        if (site === 'cvonline' && /^rodyti \d+ rezultat/i.test(normalized(button.innerText))) {
            const form = Array.from(document.forms).find(searchForm => searchForm.querySelector('[name="salaryFrom"]'));
            if (!form) {
                console.warn('Job Search Toolkit: could not find the CV-Online salary search form.');
                return;
            }
            applyNativeSalarySearch(form, site);
            const searchUrl = new URL(location.href);
            if (searchUrl.searchParams.get('salaryFrom') !== salaryFloor
                || searchUrl.searchParams.get('ratePer') !== 'MONTHLY') {
                searchUrl.searchParams.set('salaryFrom', salaryFloor);
                searchUrl.searchParams.set('ratePer', 'MONTHLY');
                event.preventDefault();
                event.stopPropagation();
                location.assign(searchUrl.href);
            }
            return;
        }
        if (site === 'workinlithuania' && normalized(button.innerText) === 'apply filters') {
            const salaryInput = document.querySelector('input[type="number"][placeholder="From"]');
            if (!setSearchControlValue(salaryInput, salaryFloor)) {
                console.warn('Job Search Toolkit: could not find the Work in Lithuania salary search field.');
                return;
            }
            const searchUrl = new URL(location.href);
            if (searchUrl.searchParams.get('filter[salary]') !== salaryFloor) {
                searchUrl.searchParams.set('filter[salary]', salaryFloor);
                location.assign(searchUrl.href);
            }
        }
    }, true);

    function createSalaryHighlight(value, precedingText = '', followingText = '', ownerDocument = document) {
        const range = monthlySalaryRange(value, precedingText, followingText);
        const span = ownerDocument.createElement('span');
        span.className = 'li-tools-salary-highlight';
        if (range) {
            span.classList.add(range[1] >= settings.salaryMinimum ? 'li-tools-salary-above' : 'li-tools-salary-below');
            span.title = `Compared numerically with minimum ${settings.salaryMinimum.toLocaleString()} per month; currency is not converted`;
        }
        return span;
    }

    function highlightSalaryRangesAcrossInlineElements(root) {
        const ownerDocument = root.ownerDocument;
        const nodeFilter = ownerDocument.defaultView.NodeFilter;
        const blocks = [...(root.matches('p, li, .salary-label, .salary_text, [data-component="badge"]') ? [root] : []), ...root.querySelectorAll('p, li, .salary-label, .salary_text, [data-component="badge"]')];
        let count = 0;
        for (const block of blocks) {
            const walker = ownerDocument.createTreeWalker(block, nodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    return node.parentElement?.closest('script, style, button, input, textarea, select, option, [data-li-job-tools], .li-tools-salary-highlight') ?
                        nodeFilter.FILTER_REJECT : nodeFilter.FILTER_ACCEPT;
                }
            });
            const entries = [];
            let text = '';
            let node;
            while ((node = walker.nextNode())) {
                const value = node.textContent || '';
                if (!value) continue;
                entries.push({ node, start: text.length, end: text.length + value.length });
                text += value;
            }
            const matches = Array.from(text.matchAll(new RegExp(salaryMatcher.source, salaryMatcher.flags)))
                .filter(match => new RegExp(salaryCurrencyPattern, 'i').test(match[0]));
            for (const match of matches.reverse()) {
                const start = match.index;
                const end = start + match[0].length;
                const startEntry = entries.find(entry => start >= entry.start && start < entry.end);
                const endEntry = entries.find(entry => end > entry.start && end <= entry.end);
                if (!startEntry || !endEntry) continue;
                const range = ownerDocument.createRange();
                range.setStart(startEntry.node, start - startEntry.start);
                range.setEnd(endEntry.node, end - endEntry.start);
                const highlight = createSalaryHighlight(
                    match[0],
                    text.slice(Math.max(0, start - 100), start),
                    text.slice(end, end + 100),
                    ownerDocument
                );
                highlight.appendChild(range.extractContents());
                range.insertNode(highlight);
                count++;
            }
        }
        return count;
    }

    function highlightSalaries(root) {
        if (!root) return;
        const text = root.textContent || '';
        const hasSalaryContainer = root.matches('.salary-label, .salary_text, [data-component="badge"]')
            || root.querySelector('.salary-label, .salary_text, [data-component="badge"]');
        const signature = `${settings.salaryMinimum}\u0000${text}`;
        const previous = salarySignature.get(root);
        const currentCount = root.querySelectorAll('.li-tools-salary-highlight').length;
        if (previous?.signature === signature && previous.count === currentCount) return;
        unwrapHighlights(root, '.li-tools-salary-highlight');
        let count = 0;
        if (settings.salaryMinimum > 0) {
            count = highlightSalaryRangesAcrossInlineElements(root);
            count += replaceTextNodes(root, salaryMatcher, (value, precedingText, followingText) => {
                const highlight = createSalaryHighlight(value, precedingText, followingText, root.ownerDocument);
                highlight.textContent = value;
                return highlight;
            }, (match, content) => {
                if (hasSalaryContainer && getSite() !== 'workinlithuania') return false;
                const before = content.slice(0, match.index).split('\n').pop();
                const after = content.slice(match.index + match[0].length).split('\n')[0];
                return isSalaryMatch(match[0], before, after)
                    || (getSite() === 'workinlithuania' && /^\d[\d .,]*\s*(?:-|–|—|to)\s*\d[\d .,]*$/i.test(match[0]));
            });
        }
        salarySignature.set(root, { signature, count });
    }

    function addBlock(card, kind) {
        const { company, position } = getJobDetails(card);
        if (kind === 'employer' && company && !settings.blockedEmployers.some(item => normalized(item) === normalized(company))) {
            settings.blockedEmployers.push(company);
        } else if (kind === 'pair' && company && position && !settings.blockedEmployerPositions.some(item =>
            normalized(item.company) === normalized(company) && normalized(item.position) === normalized(position)
        )) {
            settings.blockedEmployerPositions.push({ company, position });
        } else if (kind === 'position' && position && !settings.blockedPositions.some(item => normalized(item) === normalized(position))) {
            settings.blockedPositions.push(position);
        } else {
            status.textContent = 'Could not add that block: listing details are missing or already blocked.';
            return;
        }
        status.textContent = 'Block added.';
        saveSettings().then(() => {
            renderBlockedLists();
            applyFilter();
        });
    }

    function openBlockValueDialog(value, kind) {
        const isPhrase = kind === 'phrase';
        const labelText = isPhrase ? 'Phrase to block' : 'Position to block';
        const titleText = isPhrase ? 'Block phrase' : 'Block position';
        const listKey = isPhrase ? 'blockedPhrases' : 'blockedPositions';
        const dialog = document.createElement('dialog');
        dialog.id = 'li-tools-block-value-dialog';
        dialog.setAttribute('aria-labelledby', 'li-tools-block-value-title');
        const title = document.createElement('h2');
        title.id = 'li-tools-block-value-title';
        title.textContent = titleText;
        const form = document.createElement('form');
        const fieldLabel = document.createElement('label');
        fieldLabel.htmlFor = 'li-tools-block-value-input';
        fieldLabel.textContent = `${labelText} (required)`;
        const input = document.createElement('input');
        input.id = fieldLabel.htmlFor;
        input.type = 'text';
        input.value = value;
        input.required = true;
        const actions = document.createElement('div');
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', () => dialog.close());
        const save = document.createElement('button');
        save.type = 'submit';
        save.textContent = isPhrase ? 'Save phrase' : 'Save position';
        actions.append(cancel, save);
        form.append(fieldLabel, input, actions);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            if (await addListEntry(listKey, [input.value])) dialog.close();
            else input.focus();
        });
        dialog.append(title, form);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.appendChild(dialog);
        dialog.showModal();
        input.focus();
    }

    function addBlockActions(menu, card, closeMenu) {
        const section = document.createElement('div');
        section.className = 'li-tools-menu';
        section.dataset.liJobTools = '1';
        section.setAttribute('role', 'group');
        section.setAttribute('aria-label', 'Job tools');
        const title = document.createElement('strong');
        title.textContent = 'Job tools';
        section.appendChild(title);
        for (const [label, kind] of [['Block employer', 'employer'], ['Block employer + position', 'pair'], ['Block position', 'position']]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                addBlock(card, kind);
                closeMenu();
            });
            section.appendChild(button);
        }
        const phraseButton = document.createElement('button');
        phraseButton.type = 'button';
        phraseButton.textContent = 'Block phrase...';
        phraseButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            openBlockValueDialog(getJobDetails(card).position, 'phrase');
        });
        section.appendChild(phraseButton);
        menu.appendChild(section);
    }

    function ensureCardBlockMenu(card) {
        if (card.querySelector('.li-tools-card-trigger')) return;
        const isLinkedIn = getSite() === 'linkedin';
        const dismiss = isLinkedIn ? card.querySelector('button[aria-label^="Dismiss"]') : null;
        if (isLinkedIn && card.querySelector('button[aria-label*="more" i]')) return;
        const actions = dismiss?.parentElement || document.createElement('div');
        const floating = !dismiss;
        if (floating) {
            card.classList.add('li-tools-card-container');
            actions.classList.add('li-tools-card-actions-floating');
            actions.dataset.liJobTools = '1';
        }
        actions.classList.add('li-tools-card-actions');
        const nativeTrigger = isLinkedIn ? document.querySelector('button[aria-label="More options"]') : null;
        const trigger = nativeTrigger?.cloneNode(true) || document.createElement('button');
        trigger.type = 'button';
        trigger.classList.add('li-tools-card-trigger');
        if (nativeTrigger) {
            for (const attribute of Array.from(trigger.attributes)) {
                if (attribute.name.startsWith('aria-') || attribute.name.startsWith('data-') || attribute.name === 'id') {
                    trigger.removeAttribute(attribute.name);
                }
            }
        } else {
            trigger.textContent = '...';
        }
        trigger.dataset.liJobTools = '1';
        const { company, position } = getJobDetails(card);
        trigger.setAttribute('aria-label', `Job tools for ${position || 'listing'}${company ? ` at ${company}` : ''}`);
        trigger.setAttribute('aria-expanded', 'false');
        if (!isLinkedIn) {
            const appliedKey = getAppliedJobKey(card);
            const appliedCheckbox = document.createElement('input');
            appliedCheckbox.type = 'checkbox';
            appliedCheckbox.className = 'li-tools-applied-checkbox';
            appliedCheckbox.dataset.liJobTools = '1';
            appliedCheckbox.setAttribute('aria-label', `Mark ${position || 'listing'}${company ? ` at ${company}` : ''} as applied`);
            appliedCheckbox.title = 'Mark as applied';
            appliedCheckbox.checked = !!appliedKey && settings.appliedJobs.includes(appliedKey);
            appliedCheckbox.disabled = !appliedKey;
            appliedCheckbox.addEventListener('click', event => {
                event.stopPropagation();
            });
            appliedCheckbox.addEventListener('change', async () => {
                if (appliedCheckbox.checked) {
                    if (!settings.appliedJobs.includes(appliedKey)) settings.appliedJobs.push(appliedKey);
                } else {
                    settings.appliedJobs = settings.appliedJobs.filter(key => key !== appliedKey);
                }
                const saved = await saveSettings();
                applyFilter();
                setStatus(saved ? 'Applied status saved.' : 'Could not save applied status. Check the console.');
            });
            actions.appendChild(appliedCheckbox);

            const hiddenCheckbox = document.createElement('input');
            hiddenCheckbox.type = 'checkbox';
            hiddenCheckbox.className = 'li-tools-hidden-checkbox';
            hiddenCheckbox.dataset.liJobTools = '1';
            hiddenCheckbox.setAttribute('aria-label', `Mark ${position || 'listing'}${company ? ` at ${company}` : ''} as hidden`);
            hiddenCheckbox.title = 'Mark as hidden';
            hiddenCheckbox.checked = !!appliedKey && settings.hiddenJobs.includes(appliedKey);
            hiddenCheckbox.disabled = !appliedKey;
            hiddenCheckbox.addEventListener('click', event => {
                event.stopPropagation();
            });
            hiddenCheckbox.addEventListener('change', async () => {
                if (hiddenCheckbox.checked) {
                    if (!settings.hiddenJobs.includes(appliedKey)) settings.hiddenJobs.push(appliedKey);
                } else {
                    settings.hiddenJobs = settings.hiddenJobs.filter(key => key !== appliedKey);
                }
                const saved = await saveSettings();
                applyFilter();
                setStatus(saved ? 'Hidden status saved.' : 'Could not save hidden status. Check the console.');
            });
            actions.appendChild(hiddenCheckbox);
        }
        const menu = document.createElement('div');
        menu.id = `li-tools-card-menu-${++cardMenuId}`;
        menu.className = 'li-tools-card-menu';
        menu.hidden = true;
        menu.dataset.liJobTools = '1';
        addBlockActions(menu, card, () => {
            menu.hidden = true;
            card.classList.remove('li-tools-card-open');
            trigger.setAttribute('aria-expanded', 'false');
        });
        trigger.setAttribute('aria-controls', menu.id);
        trigger.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            document.querySelectorAll('.li-tools-card-menu:not([hidden])').forEach(openMenu => {
                openMenu.hidden = true;
                openMenu.parentElement.querySelector('.li-tools-card-trigger')?.setAttribute('aria-expanded', 'false');
                openMenu.parentElement.closest('.li-tools-card-container, li[data-occludable-job-id], div[role="button"]')?.classList.remove('li-tools-card-open');
            });
            menu.hidden = false;
            card.classList.add('li-tools-card-open');
            trigger.setAttribute('aria-expanded', 'true');
            menu.querySelector('.li-tools-menu button')?.focus();
        });
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                menu.hidden = true;
                card.classList.remove('li-tools-card-open');
                trigger.setAttribute('aria-expanded', 'false');
                trigger.focus();
            }
        });
        actions.insertBefore(trigger, dismiss);
        actions.appendChild(menu);
        if (floating) card.appendChild(actions);
    }

    function enhanceListingMenu() {
        if (!openMenuCard?.isConnected) return;
        const selectors = '[role="menu"], .artdeco-dropdown__content-inner, .artdeco-dropdown__content';
        const visible = element => !element.hidden && element.getClientRects().length > 0;
        const inCard = Array.from(openMenuCard.querySelectorAll(selectors)).filter(visible);
        const candidates = inCard.length ? inCard : Array.from(document.querySelectorAll(selectors)).filter(visible);
        const menu = candidates.find(element => /why.{0,40}see(?:ing)?/i.test(element.innerText))
            || candidates.find(element => !element.querySelector('.li-tools-menu'));
        if (!menu) return;
        const why = Array.from(menu.querySelectorAll('[role="menuitem"], button, li'))
            .find(element => /why.{0,40}see(?:ing)?/i.test(element.innerText.trim()));
        if (why) {
            const whyItem = why.closest('li, [role="menuitem"]') || why;
            whyItem.hidden = true;
            whyItem.style.setProperty('display', 'none', 'important');
        }
        if (menu.querySelector('.li-tools-menu')) return;
        addBlockActions(menu, openMenuCard, () => {
            openMenuCard.querySelector('button[aria-label*="more" i], button[aria-label*="options" i]')?.click();
            openMenuCard = null;
        });
    }

    document.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target || target.closest('[data-li-job-tools]')) return;
        document.querySelectorAll('.li-tools-card-menu:not([hidden])').forEach(menu => {
            if (menu.contains(target) || menu.parentElement.querySelector('.li-tools-card-trigger')?.contains(target)) return;
            menu.hidden = true;
            menu.parentElement.querySelector('.li-tools-card-trigger')?.setAttribute('aria-expanded', 'false');
            menu.parentElement.closest('.li-tools-card-container, li[data-occludable-job-id], div[role="button"]')?.classList.remove('li-tools-card-open');
        });
        const trigger = target.closest('button[aria-label*="more" i], button[aria-label*="options" i], button[data-control-name*="overflow" i]');
        if (trigger) {
            openMenuCard = trigger.closest('li[data-occludable-job-id]')
                || trigger.closest('div[role="button"]')
                || trigger.closest('a[href*="currentJobId="]');
            setTimeout(enhanceListingMenu, 100);
        } else if (!target.closest('[role="menu"], .artdeco-dropdown__content-inner, .artdeco-dropdown__content')) {
            openMenuCard = null;
        }
    }, true);

    function processPage() {
        updateLayout();
        schedulePreferredCVFill();
        observePinokisAppliedConfirmation(document);
        setupJobPreview();
        enhanceJobPreviewFrame();
        applyFilter();
        getJobCards().forEach(highlightSalaries);
        const details = document.querySelector('.jobs-description__content')
            || document.querySelector('.jobs-description__text')
            || document.querySelector('#job-details')
            || Array.from(document.querySelectorAll('[data-testid="lazy-column"]')).find(column =>
                Array.from(column.querySelectorAll('h2')).some(title => title.innerText.trim() === 'About the job')
            );
        if (details) {
            const isMoreButton = button => /^(?:(?:…|\.{3})\s*)?more$|^show more$/i.test(button.innerText.trim())
                || /^(?:(?:…|\.{3})\s*)?more$|^show more$/i.test(button.getAttribute('aria-label') || '');
            const aboutHeading = Array.from(document.querySelectorAll('h2, h3, [role="heading"]'))
                .find(heading => heading.innerText.trim().toLowerCase() === 'about the job');
            const aboutJobSection = aboutHeading?.parentElement?.parentElement;
            const moreButton = Array.from(aboutJobSection?.querySelectorAll('button') || [])
                .find(button => button.getClientRects().length
                    && !expandedMoreButtons.has(button)
                    && isMoreButton(button));
            if (moreButton) {
                expandedMoreButtons.add(moreButton);
                moreButton.click();
                scheduleProcess();
            }
            highlightSkills(details);
            highlightSalaries(details);
        }
        enhanceListingMenu();
    }

    function scheduleProcess() {
        clearTimeout(processTimer);
        processTimer = setTimeout(processPage, 120);
    }

    window.addEventListener('resize', scheduleProcess);

    const observer = new MutationObserver(scheduleProcess);
    observer.observe(document.body, { childList: true, subtree: true });
    processPage();
})();
