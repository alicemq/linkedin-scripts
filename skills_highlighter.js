// ==UserScript==
// @name         LinkedIn Job Skills Highlighter
// @namespace    http://github.com/ArmanJR
// @version      1.6
// @description  Highlight skills in LinkedIn job postings with color groups and handle dynamic job selection
// @author       Arman JR. + matty
// @match        https://www.linkedin.com/jobs/*
// @match        https://www.linkedin.com/jobs/view/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';
    console.log('LinkedIn Job Skills Highlighter loaded');

    const skillsHighlight = {
    strong: { color: '#0fe800', skills: [ 'Go','Golang','Java','Python','C++','C#','Rust','Kotlin','Scala','Ruby','Swift','Erlang','Elixir','Haskell','PHP','Objective-C' ] },
    intermediate: { color: '#f5ed00', skills: [ 'Spring','Spring Boot','Spring MVC','Spring Cloud','Django','Django REST Framework','Flask','Express','NestJS','Koa','ASP.NET','ASP.NET Core','Blazor','React','React Native','Vue.js','Nuxt.js','Svelte','Angular','Ember.js','Backbone.js','Meteor','Ruby on Rails','Laravel','GraphQL','REST','gRPC','WebSockets','Next.js','Gatsby' ] },
    technologies: { color: '#00aaff', skills: [ '.NET','MS SQL','Axapta','MySQL','PostgreSQL','MongoDB','Redis','Elasticsearch','Docker','Kubernetes','AWS','Azure','GCP','Terraform','Ansible','Jenkins','Git','GitHub Actions' ] },
    leadership: { color: '#0073b1', skills: [ 'Team Leadership','Stakeholder Management','Process Definition','Strategy Development','Roadmapping','Budget Management','KPI Tracking','Change Management','Outsourced Management','Software Development Oversight','Cross-functional Alignment' ] },
    behaviors: { color: '#ff7f6b', skills: [ 'Problem Solving','Decision Making','Priority Management','Attention to Detail','Innovation','Adaptability','Mentoring','Team Collaboration','Cross-functional Communication','Conflict Resolution','Emotional Intelligence' ] },
    itManagement: { color: '#0073b1', skills: [ 'ITIL','ITSM','COBIT','ISO 20000','ISO 27001','ServiceNow','BMC Remedy','Cherwell','Jira Service Desk','ITOM','SRE Practices','Azure DevOps','AWS CloudFormation','Puppet','Chef','Nagios','Splunk' ] },
    governance: { color: '#d2691e', skills: [ 'PMP','PRINCE2','Six Sigma','Lean IT','CMMI','TOGAF','Enterprise Architecture','Risk Management','SOX Compliance','GDPR','HIPAA','Business Continuity Planning','Vendor Management','Audit Management','Agile Ceremonies','Kanban','SAFe','Jira','Confluence','Agile' ] },
    compensation: { color: '#ffa500', skills: [ 'Salary','Wage','Compensation','Remuneration','Pay','Base Salary','Bonus','Equity','Stock Options','Benefits','Overtime','Incentives' ] }
};

    let lastURL = location.href;

    function waitFor(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const interval = 200;
            let elapsed = 0;
            const timer = setInterval(() => {
                const el = document.querySelector(selector);
                if (el) { clearInterval(timer); resolve(el); }
                elapsed += interval;
                if (elapsed >= timeout) { clearInterval(timer); reject(); }
            }, interval);
        });
    }

    async function expandDescription() {
        const selectors = ['button.show-more-less-text__button', 'button[aria-label*="show more"]'];
        for (const sel of selectors) {
            try {
                const btn = await waitFor(sel, 2000);
                if (/show more/i.test(btn.textContent)) { btn.click(); console.log('Expanded description'); }
                return;
            } catch {}
        }
    }

    function highlightSkills() {
        const container = document.querySelector('.jobs-description__content')
                       || document.querySelector('.jobs-description__text')
                       || document.querySelector('#job-details');
        if (!container) {
            console.log('Description container not found');
            return;
        }
        // remove previous highlights
        container.querySelectorAll('span[data-skill-highlight]').forEach(el => {
            el.replaceWith(document.createTextNode(el.textContent));
        });
        delete container.dataset.processed;

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) nodes.push(node);

        let count = 0;
        nodes.forEach(textNode => {
            let text = textNode.textContent;
            let changed = false;
            for (const grp of Object.values(skillsHighlight)) {
                grp.skills.forEach(skill => {
                    const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const re = new RegExp(`(^|\\W)(${esc})(?=\\W|$)`, 'gi');
                    if (re.test(text)) {
                        changed = true;
                        count++;
                        text = text.replace(re, `$1<span data-skill-highlight style="background:${grp.color};padding:0 2px;border-radius:2px;font-weight:500;">$2</span>`);
                    }
                });
            }
            if (changed) {
                const span = document.createElement('span');
                span.innerHTML = text;
                textNode.parentNode.replaceChild(span, textNode);
            }
        });
        container.dataset.processed = '1';
        console.log(`Highlighted ${count} skills`);
    }

    async function processJob() {
        console.log('Processing job details...');
        await expandDescription();
        highlightSkills();
    }

    // Observe URL navigation
    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastURL) {
            lastURL = location.href;
            setTimeout(processJob, 100);
        }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });

    // Observe content changes in details pane
    const paneSelector = '.jobs-search-two-pane__details';
    waitFor(paneSelector, 10000).then(pane => {
        new MutationObserver(() => {
            setTimeout(processJob, 100);
        }).observe(pane, { childList: true, subtree: true });
    }).catch(() => console.log('Details pane not found'));

    processJob();
})();
