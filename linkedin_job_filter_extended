// ==UserScript==
// @name         LinkedIn Job Filter Pro Extended
// @namespace    http://tampermonkey.net/
// @version      4.9
// @description  Advanced filters and phrase-based filtering for LinkedIn job listings with auto-open next
// @author       yange.xyz + matty
// @match        https://www.linkedin.com/jobs/*
// @grant        none
// @license      MIT
// ==/UserScript==

(function(){
    'use strict';
    const STORAGE_KEY = 'linkedinJobFilterSettings';
    const FILTERS = { SHOW_ALL: 'SHOW_ALL', SHOW_PROMOTED: 'SHOW_PROMOTED', SHOW_NORMAL: 'SHOW_NORMAL' };
    let settings = { activeFilter: FILTERS.SHOW_ALL, onlyUnviewed: false, onlyUnhidden: false, onlyUnapplied: false, blockedPhrases: [] };

    function saveSettings(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
    function loadSettings(){ const d = localStorage.getItem(STORAGE_KEY); if(d) try { settings = JSON.parse(d); } catch{} }
    loadSettings();

    // UI Panel
    const panel = document.createElement('div');
    Object.assign(panel.style,{ position:'fixed',top:'40px',right:'20px',zIndex:'9999',background:'#fff',padding:'8px',border:'1px solid #ccc',borderRadius:'8px',boxShadow:'0 2px 8px rgba(0,0,0,0.15)',fontFamily:'Arial,sans-serif',display:'flex',flexDirection:'column',gap:'4px',minWidth:'220px'});
    document.body.appendChild(panel);
    const toggleBtn = document.createElement('button');
    toggleBtn.innerText='⚙️';
    Object.assign(toggleBtn.style,{position:'fixed',top:'10px',right:'20px',zIndex:'10000',padding:'6px',borderRadius:'50%',border:'1px solid #ccc',background:'#f3f3f3',cursor:'pointer'});
    toggleBtn.onclick=()=>panel.style.display=panel.style.display==='none'?'flex':'none';
    document.body.appendChild(toggleBtn);

    function makeBtn(label,handler){
        const b=document.createElement('button');
        b.innerText=label;
        Object.assign(b.style,{padding:'6px',border:'1px solid #0073b1',borderRadius:'4px',background:'#0073b1',color:'#fff',fontWeight:'bold',cursor:'pointer',textAlign:'center'});
        b.onclick=_=>handler(b);
        return b;
    }

    // Filter buttons
    panel.appendChild(makeBtn('👁 Show All',b=>{settings.activeFilter=FILTERS.SHOW_ALL;saveSettings();applyFilter();}));
    panel.appendChild(makeBtn('💼 Promoted Only',b=>{settings.activeFilter=FILTERS.SHOW_PROMOTED;saveSettings();applyFilter();}));
    panel.appendChild(makeBtn('🔍 Normal Only',b=>{settings.activeFilter=FILTERS.SHOW_NORMAL;saveSettings();applyFilter();}));
    panel.appendChild(makeBtn(`🕵️ Only Unviewed: ${settings.onlyUnviewed?'ON':'OFF'}`,b=>{settings.onlyUnviewed=!settings.onlyUnviewed; b.innerText=`🕵️ Only Unviewed: ${settings.onlyUnviewed?'ON':'OFF'}`; saveSettings(); applyFilter();}));
    panel.appendChild(makeBtn(`🚫 Hide Hidden: ${settings.onlyUnhidden?'ON':'OFF'}`,b=>{settings.onlyUnhidden=!settings.onlyUnhidden; b.innerText=`🚫 Hide Hidden: ${settings.onlyUnhidden?'ON':'OFF'}`; saveSettings(); applyFilter();}));
    panel.appendChild(makeBtn(`📮 Hide Applied: ${settings.onlyUnapplied?'ON':'OFF'}`,b=>{settings.onlyUnapplied=!settings.onlyUnapplied; b.innerText=`📮 Hide Applied: ${settings.onlyUnapplied?'ON':'OFF'}`; saveSettings(); applyFilter();}));

    // Blocked phrases UI
    const phraseToggle = makeBtn(settings.blockedPhrases.length?'🔽 Blocked Phrases':'▶️ Blocked Phrases',b=>{ phraseContainer.style.display=phraseContainer.style.display==='none'?'flex':'none'; b.innerText=phraseContainer.style.display==='none'?'▶️ Blocked Phrases':'🔽 Blocked Phrases'; });
    panel.appendChild(phraseToggle);
    const phraseContainer=document.createElement('div');
    Object.assign(phraseContainer.style,{display:'none',flexDirection:'column',gap:'4px'});
    panel.appendChild(phraseContainer);
    const phraseInput=document.createElement('input'); phraseInput.placeholder='Block phrase...'; Object.assign(phraseInput.style,{padding:'4px',fontSize:'12px'}); phraseContainer.appendChild(phraseInput);
    const listDiv=document.createElement('div'); Object.assign(listDiv.style,{display:'flex',flexDirection:'column',gap:'2px',maxHeight:'360px',overflowY:'auto'}); phraseContainer.appendChild(listDiv);
    function renderPhraseList(){
        listDiv.innerHTML='';
        settings.blockedPhrases.forEach((p,i)=>{
            const row=document.createElement('div');
            Object.assign(row.style,{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'2px 4px',border:'1px solid #ccc',borderRadius:'4px'});
            const span=document.createElement('span'); span.innerText=p;
            const del=document.createElement('button'); del.innerText='❌'; Object.assign(del.style,{background:'none',border:'none',cursor:'pointer'});
            del.onclick=_=>{ settings.blockedPhrases.splice(i,1); saveSettings(); renderPhraseList(); applyFilter(); };
            row.append(span,del);
            listDiv.append(row);
        });
    }
    const addPhraseBtn=makeBtn('➕ Add Phrase',b=>{
        const v=phraseInput.value.trim();
        if(v&&!settings.blockedPhrases.includes(v)){
            settings.blockedPhrases.push(v);
            saveSettings();
            renderPhraseList();
            applyFilter();
            openNextVisibleCard();
        }
        phraseInput.value='';
    });
    phraseContainer.appendChild(addPhraseBtn);
    renderPhraseList();

    // Styles for block button on hover
    document.head.appendChild(Object.assign(document.createElement('style'),{textContent:`
        .block-phrase-btn{ display:none; background:transparent; border:none; cursor:pointer; font-size:12px; color:#000; border-radius:4px; padding:2px 6px; margin-left:4px; }
        .block-phrase-btn:hover{ background:#e6e6e6; }
        li[data-occludable-job-id]:hover .block-phrase-btn{ display:inline-block!important; }
    `}));

    // Helpers to open cards
    function getVisibleCards(){
        return Array.from(document.querySelectorAll('li[data-occludable-job-id]')).filter(li=>li.offsetParent!==null);
    }
    function openNextVisibleCard(cur){
        const visible = getVisibleCards();
        let target;
        if(cur){
            const idx = visible.indexOf(cur);
            if(idx>=0 && idx<visible.length-1) target = visible[idx+1];
        }
        if(!target && visible.length) target = visible[0];
        if(target){
            const link = target.querySelector('a.job-card-list__title--link');
            if(link) link.click();
        } else console.log('No visible card to open');
    }

    // Main filter and button injection
    function applyFilter(){
        const cards = Array.from(document.querySelectorAll('li[data-occludable-job-id]'));
        cards.forEach(card=>{
            const jobDiv = card.querySelector('div.job-card-container[data-job-id]');
            if(!jobDiv) return;

            // inject block button
            if(!card.querySelector('.block-phrase-btn')){
                const title = card.querySelector('a.job-card-list__title--link');
                const btn = document.createElement('button');
                btn.innerText='🚫';
                btn.className='block-phrase-btn';
                btn.title='Block this job title';
                btn.onclick=e=>{
                    e.stopPropagation();
                    const str = title.querySelector('strong');
                    const ph = str?str.innerText.trim():title.innerText.trim();
                    if(!settings.blockedPhrases.includes(ph)){
                        settings.blockedPhrases.push(ph);
                        saveSettings(); renderPhraseList(); applyFilter(); openNextVisibleCard(card);
                    }
                };
                const actions = card.querySelector('.job-card-list__actions-container');
                if(actions){
                    const closeDiv = actions.querySelector('div');
                    if(closeDiv) closeDiv.insertAdjacentElement('beforebegin', btn);
                    else actions.insertBefore(btn, actions.firstChild);
                }
            }

            // attach dismissal handler
            const dismiss = card.querySelector('button[aria-label*="Dismiss"]');
            if(dismiss && !dismiss.dataset.next){
                dismiss.dataset.next='1';
                dismiss.onclick=()=>{ openNextVisibleCard(card); };
            }

            // compute visibility
            const text = jobDiv.innerText.toLowerCase();
            const isPromoted = !!jobDiv.querySelector('.job-card-container__footer-item--highlighted');
            const isViewed = text.includes('viewed');
            const isHidden = text.includes('won’t show you this job')||text.includes('we won’t show you this job');
            const isApplied = text.includes('applied');
            const blocked = settings.blockedPhrases.some(x=>text.includes(x.toLowerCase()));
            const isActive = jobDiv.getAttribute('aria-current')==='page';
            let vis = true;
            if(settings.onlyUnviewed && isViewed && !isActive) vis=false;
            if(settings.onlyUnhidden && isHidden) vis=false;
            if(settings.onlyUnapplied && isApplied) vis=false;
            if(blocked) vis=false;
            if(settings.activeFilter===FILTERS.SHOW_PROMOTED) vis=isPromoted;
            if(settings.activeFilter===FILTERS.SHOW_NORMAL) vis=!isPromoted;
            card.style.display = vis?'':'none';
        });
    }

    // observe and initialize
    const observer = new MutationObserver(applyFilter);
    observer.observe(document.body,{ childList:true, subtree:true });
    applyFilter();
    openNextVisibleCard();
})();
