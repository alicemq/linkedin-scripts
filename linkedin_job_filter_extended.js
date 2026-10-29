// ==UserScript==
// @name         LinkedIn Job Search Toolkit
// @namespace    http://tampermonkey.net/
// @version      6.16
// @description  Filter jobs, block listings, and highlight skills and salaries
// @author       yange.xyz + matty
// @match        https://www.linkedin.com/jobs/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(async function () {
    'use strict';

    const STORAGE_KEY = 'linkedinJobFilterSettings';
    const FILTERS = { SHOW_ALL: 'SHOW_ALL', SHOW_PROMOTED: 'SHOW_PROMOTED', SHOW_NORMAL: 'SHOW_NORMAL' };
    const defaults = {
        activeFilter: FILTERS.SHOW_ALL,
        onlyUnviewed: false,
        onlyUnhidden: false,
        onlyUnapplied: false,
        blockedPhrases: [],
        blockedEmployers: [],
        blockedEmployerPositions: [],
        blockedPositions: [],
        skillsEnabled: true,
        skills: [],
        skillCategories: [],
        salaryMinimum: 0,
        mainWidth: 100,
        detailsWidth: 65
    };
    let settings = { ...defaults };
    let openMenuCard = null;
    let cardMenuId = 0;
    let processTimer;
    const expandedMoreButtons = new WeakSet();

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
            console.error('LinkedIn Job Search Toolkit: could not save settings.', error);
            return false;
        }
    }

    async function loadSettings() {
        try {
            const stored = await GM_getValue(STORAGE_KEY, null);
            if (stored) {
                const saved = typeof stored === 'string' ? JSON.parse(stored) : stored;
                settings = { ...defaults, ...saved };
            }
        } catch (error) {
            console.error('LinkedIn Job Search Toolkit: could not load settings; using defaults.', error);
        }
        if (!Object.values(FILTERS).includes(settings.activeFilter)) settings.activeFilter = FILTERS.SHOW_ALL;
        for (const key of ['blockedPhrases', 'blockedEmployers', 'blockedEmployerPositions', 'blockedPositions']) {
            if (!Array.isArray(settings[key])) settings[key] = [];
        }
        for (const key of ['blockedPhrases', 'blockedEmployers', 'blockedPositions']) {
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
    }

    await loadSettings();

    const panel = document.createElement('section');
    panel.id = 'li-job-tools-panel';
    panel.setAttribute('aria-label', 'LinkedIn job search tools');
    Object.assign(panel.style, {
        position: 'fixed', top: '52px', right: '16px', zIndex: '9999',
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
    toggleButton.setAttribute('aria-label', 'Toggle LinkedIn job tools');
    toggleButton.setAttribute('aria-controls', panel.id);
    toggleButton.setAttribute('aria-expanded', 'true');
    Object.assign(toggleButton.style, {
        position: 'fixed', top: '10px', right: '16px', zIndex: '10000',
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
        #li-job-tools-panel { box-sizing: border-box; width: max-content; }
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
        .li-tools-card-actions { position: relative !important; z-index: 10003 !important; overflow: visible !important; }
        .li-tools-card-open { position: relative !important; z-index: 10002 !important; }
        .li-tools-card-trigger { min-width: 32px; min-height: 32px; }
        .li-tools-card-menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 10004; width: 240px; padding: 8px; border: 1px solid #767676; border-radius: 6px; background: #fff; color: #202124; box-shadow: 0 2px 8px rgba(0,0,0,.2); }
        .li-tools-card-menu[hidden] { display: none !important; }
        .li-tools-card-menu button:focus-visible { outline: 3px solid #111; outline-offset: 2px; }
        @media (min-width: 1200px) {
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
        }
        @media (max-width: 700px) {
            #li-job-tools-panel:not([hidden]) { width: calc(100vw - 16px); height: calc(100vh - 58px); max-height: min(1000px, calc(100vh - 58px)); right: 8px; top: 50px; flex-direction: column; }
            .li-tools-column { min-width: 0; }
            #li-tools-editor { flex: 0 1 auto; width: 100%; }
            #li-tools-editor > .li-tools-section:not([hidden]) { flex: 1 1 auto; }
        }
        @media (forced-colors: active) {
            #li-job-tools-panel, #li-job-tools-panel button, #li-job-tools-panel input,
            .li-tools-menu button, .li-tools-card-menu, .li-tools-card-trigger { border-color: ButtonBorder; background: Canvas; color: CanvasText; }
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
        const actions = document.createElement('div');
        actions.className = 'li-tools-row-actions';
        const description = fields.filter(field => field.type !== 'color').map(field => field.value).join(' + ');
        const saveButton = makeButton('', () => onSave(inputs.map(input => input.value)), 'li-tools-secondary li-tools-icon-button');
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

    function addToggle(label, key) {
        const button = makeButton(`${label}: ${settings[key] ? 'On' : 'Off'}`, async target => {
            hideEditor();
            settings[key] = !settings[key];
            target.textContent = `${label}: ${settings[key] ? 'On' : 'Off'}`;
            await saveSettings();
            applyFilter();
        });
        filterSection.appendChild(button);
    }
    addToggle('Only unviewed', 'onlyUnviewed');
    addToggle('Hide hidden', 'onlyUnhidden');
    addToggle('Hide applied', 'onlyUnapplied');
    rightColumn.append(filterSection, createListNavigation(), skillLabel);

    const salaryLabel = document.createElement('label');
    salaryLabel.className = 'li-tools-field';
    salaryLabel.append('Minimum salary (monthly amount)');
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
    function addRange(labelText, key, min, max, suffix) {
        const label = document.createElement('label');
        label.className = 'li-tools-field';
        const text = document.createElement('span');
        const input = document.createElement('input');
        input.className = 'li-tools-range';
        input.type = 'range';
        input.min = String(min);
        input.max = String(max);
        input.value = String(settings[key]);
        input.setAttribute('aria-label', labelText);
        const update = () => {
            settings[key] = Number(input.value);
            text.textContent = `${labelText}: ${settings[key]}${suffix}`;
            updateLayout();
        };
        input.addEventListener('input', update);
        input.addEventListener('change', async () => {
            await saveSettings();
        });
        label.append(text, input);
        layoutSection.appendChild(label);
        update();
    }
    addRange('Main content width', 'mainWidth', 70, 140, '%');
    addRange('Details pane width', 'detailsWidth', 50, 85, '%');
    rightColumn.appendChild(layoutSection);

    rightColumn.appendChild(status);

    function updateLayout() {
        document.documentElement.style.setProperty('--li-tools-main-width', `${settings.mainWidth}vw`);
        document.documentElement.style.setProperty('--li-tools-details-width', `${settings.detailsWidth}%`);
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

    function getJobDetails(card) {
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
            return;
        }
        if (settings[key].some((item, itemIndex) => itemIndex !== index && sameListEntry(key, item, entry))) {
            setStatus('That item is already in the list.');
            return;
        }
        settings[key][index] = entry;
        const saved = await saveSettings();
        applyFilter();
        setStatus(saved ? 'List item updated.' : 'Could not save settings. Check the console.');
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
            return;
        }
        if (settings.skills.some((skill, skillIndex) => skillIndex !== index && normalized(skill.name) === normalized(name))) {
            setStatus('That skill is already in the list.');
            return;
        }
        settings.skills[index] = { ...settings.skills[index], name, color };
        const saved = await saveSettings();
        processPage();
        setStatus(saved ? 'Skill updated.' : 'Could not save settings. Check the console.');
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
        const legacyCards = Array.from(document.querySelectorAll('li[data-occludable-job-id]'));
        const currentCards = Array.from(document.querySelectorAll('div[role="button"]'))
            .filter(card => card.querySelector('button[aria-label^="Dismiss"]')
                || hiddenNoticePattern.test(card.textContent || ''));
        return Array.from(new Set([...legacyCards, ...currentCards]));
    }

    function applyFilter() {
        getJobCards().forEach(card => {
            ensureCardBlockMenu(card);
            const job = card.querySelector('div.job-card-container[data-job-id]') || card;
            const text = job.innerText.toLowerCase();
            const { company, position } = getJobDetails(card);
            const isPromoted = !!job.querySelector('.job-card-container__footer-item--highlighted') || /\bpromoted\b/i.test(text);
            const isViewed = text.includes('viewed');
            const isHidden = hiddenNoticePattern.test(job.textContent || '');
            const isApplied = text.includes('applied');
            const isActive = job.getAttribute('aria-current') === 'page';
            const blocked = settings.blockedPhrases.some(phrase => includesListingText(text, phrase))
                || settings.blockedEmployers.some(employer => includesListingText(text, employer))
                || settings.blockedPositions.some(blockedPosition => includesListingText(text, blockedPosition))
                || settings.blockedEmployerPositions.some(item =>
                    includesListingText(text, item.company) && includesListingText(text, item.position)
                );
            let visible = !blocked;
            if (settings.onlyUnviewed && isViewed && !isActive) visible = false;
            if (settings.onlyUnhidden && isHidden) visible = false;
            if (settings.onlyUnapplied && isApplied) visible = false;
            if (settings.activeFilter === FILTERS.SHOW_PROMOTED) visible = visible && isPromoted;
            if (settings.activeFilter === FILTERS.SHOW_NORMAL) visible = visible && !isPromoted;
            card.classList.toggle('li-tools-filtered-out', !visible);

        });
    }

    function unwrapHighlights(root, selector) {
        root.querySelectorAll(selector).forEach(span => {
            const contents = document.createDocumentFragment();
            while (span.firstChild) contents.appendChild(span.firstChild);
            span.replaceWith(contents);
        });
    }

    function replaceTextNodes(root, matcher, createHighlight, validMatch = () => true) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                return node.parentElement?.closest('script, style, button, input, textarea, select, option, [data-li-job-tools], .li-tools-salary-highlight') ?
                    NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            for (const match of matches) {
                const start = match.index;
                if (start < lastIndex) continue;
                if (start > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
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
            if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
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
                const span = document.createElement('span');
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
    const salaryPeriodPattern = String.raw`(?:\/|per\s*)?\s*(?:hour|hr|month|mo|year|yr|annum|week|wk|day|daily|m[eė]n\.?)`;
    const salaryUnqualifiedAmountPattern = `(?:${salaryCurrencyAmountPattern}|${salaryNumberPattern})`;
    const salaryRangePattern = `(?:${salaryCurrencyAmountPattern}(?:\\s*${salaryPeriodPattern})?\\s*${salaryRangeConnector}\\s*${salaryUnqualifiedAmountPattern}(?:\\s*${salaryPeriodPattern})?|${salaryNumberPattern}(?:\\s*${salaryPeriodPattern})?\\s*${salaryRangeConnector}\\s*${salaryCurrencyAmountPattern}(?:\\s*${salaryPeriodPattern})?|${salaryCurrencyAmountPattern})`;
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
        const period = /hour|\/hr|\bhr\b/i.test(match) ? 173.33
            : /week|\/wk|\bwk\b/i.test(match) ? 52 / 12
                : /daily|day|\/day/i.test(match) ? 260 / 12
                    : /year|\/yr|\byr\b|annum/i.test(match)
                        || /\bannual(?:ly)?\b|\byearly\b|\bper year\b/i.test(context) ? 1 / 12 : 1;
        return [Math.min(...values) * period, Math.max(...values) * period];
    }

    function createSalaryHighlight(value, precedingText = '', followingText = '') {
        const range = monthlySalaryRange(value, precedingText, followingText);
        const span = document.createElement('span');
        span.className = 'li-tools-salary-highlight';
        if (range) {
            span.classList.add(range[1] >= settings.salaryMinimum ? 'li-tools-salary-above' : 'li-tools-salary-below');
            span.title = `Compared numerically with minimum ${settings.salaryMinimum.toLocaleString()} per month; currency is not converted`;
        }
        return span;
    }

    function highlightSalaryRangesAcrossInlineElements(root) {
        const blocks = [...(root.matches('p, li') ? [root] : []), ...root.querySelectorAll('p, li')];
        let count = 0;
        for (const block of blocks) {
            const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
                acceptNode(node) {
                    return node.parentElement?.closest('script, style, button, input, textarea, select, option, [data-li-job-tools], .li-tools-salary-highlight') ?
                        NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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
                const range = document.createRange();
                range.setStart(startEntry.node, start - startEntry.start);
                range.setEnd(endEntry.node, end - endEntry.start);
                const highlight = createSalaryHighlight(
                    match[0],
                    text.slice(Math.max(0, start - 100), start),
                    text.slice(end, end + 100)
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
        const signature = `${settings.salaryMinimum}\u0000${text}`;
        const previous = salarySignature.get(root);
        const currentCount = root.querySelectorAll('.li-tools-salary-highlight').length;
        if (previous?.signature === signature && previous.count === currentCount) return;
        unwrapHighlights(root, '.li-tools-salary-highlight');
        let count = 0;
        if (settings.salaryMinimum > 0) {
            count = highlightSalaryRangesAcrossInlineElements(root);
            count += replaceTextNodes(root, salaryMatcher, (value, precedingText, followingText) => {
                const highlight = createSalaryHighlight(value, precedingText, followingText);
                highlight.textContent = value;
                return highlight;
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
                event.stopPropagation();
                addBlock(card, kind);
                closeMenu();
            });
            section.appendChild(button);
        }
        menu.appendChild(section);
    }

    function ensureCardBlockMenu(card) {
        if (card.querySelector('button[aria-label*="more" i], .li-tools-card-trigger')) return;
        const dismiss = card.querySelector('button[aria-label^="Dismiss"]');
        const actions = dismiss?.parentElement;
        if (!dismiss || !actions) return;

        actions.classList.add('li-tools-card-actions');
        const nativeTrigger = document.querySelector('button[aria-label="More options"]');
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
                openMenu.parentElement.closest('li[data-occludable-job-id], div[role="button"]')?.classList.remove('li-tools-card-open');
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
            menu.parentElement.closest('li[data-occludable-job-id], div[role="button"]')?.classList.remove('li-tools-card-open');
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

    const observer = new MutationObserver(scheduleProcess);
    observer.observe(document.body, { childList: true, subtree: true });
    processPage();
})();
