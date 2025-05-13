// ==UserScript==
// @name         LinkedIn Job Filter Pro Extended
// @namespace    http://tampermonkey.net/
// @version      5.8
// @description  Advanced filters and phrase-based filtering for LinkedIn job listings with auto-open next (sandboxed storage)
// @author       yange.xyz + matty
// @match        https://www.linkedin.com/jobs/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(async function(){
    'use strict';
    const STORAGE_KEY = 'linkedinJobFilterSettings';
    const FILTERS = { SHOW_ALL: 'SHOW_ALL', SHOW_PROMOTED: 'SHOW_PROMOTED', SHOW_NORMAL: 'SHOW_NORMAL' };
    let settings = { activeFilter: FILTERS.SHOW_ALL, onlyUnviewed: false, onlyUnhidden: false, onlyUnapplied: false, blockedPhrases: [] };

    async function saveSettings(){
        try {
            await GM_setValue(STORAGE_KEY, JSON.stringify(settings));
            console.log('saveSettings:', settings);
        } catch(e){ console.error('saveSettings error:', e); }
    }

    async function loadSettings(){
        try {
            const data = await GM_getValue(STORAGE_KEY, null);
            if(data){
                settings = JSON.parse(data);
                console.log('loadSettings:', settings);
            } else {
                console.log('loadSettings using defaults:', settings);
            }
        } catch(e){ console.error('loadSettings error:', e); }
    }
    await loadSettings();

    // UI Panel
    const panel = document.createElement('div');
    Object.assign(panel.style,{ position:'fixed', top:'40px', right:'20px', zIndex:'9999', background:'#fff', padding:'8px', border:'1px solid #ccc', borderRadius:'8px', boxShadow:'0 2px 8px rgba(0,0,0,0.15)', fontFamily:'Arial,sans-serif', display:'flex', flexDirection:'column', gap:'4px', minWidth:'220px' });
    document.body.appendChild(panel);

    const toggleBtn = document.createElement('button');
    toggleBtn.innerText = '⚙️';
    Object.assign(toggleBtn.style,{ position:'fixed', top:'10px', right:'20px', zIndex:'10000', padding:'6px', borderRadius:'50%', border:'1px solid #ccc', background:'#f3f3f3', cursor:'pointer' });
    toggleBtn.onclick = () => panel.style.display = panel.style.display==='none' ? 'flex' : 'none';
    document.body.appendChild(toggleBtn);

    function makeBtn(label, handler){
        const b = document.createElement('button');
        b.innerText = label;
        Object.assign(b.style,{ padding:'6px', border:'1px solid #0073b1', borderRadius:'4px', background:'#0073b1', color:'#fff', fontWeight:'bold', cursor:'pointer', textAlign:'center' });
        b.onclick = () => handler(b);
        return b;
    }

    panel.appendChild(makeBtn('👁 Show All', async b=>{ settings.activeFilter=FILTERS.SHOW_ALL; await saveSettings(); applyFilter(); }));
    panel.appendChild(makeBtn('💼 Promoted Only', async b=>{ settings.activeFilter=FILTERS.SHOW_PROMOTED; await saveSettings(); applyFilter(); }));
    panel.appendChild(makeBtn('🔍 Normal Only', async b=>{ settings.activeFilter=FILTERS.SHOW_NORMAL; await saveSettings(); applyFilter(); }));
    panel.appendChild(makeBtn(`🕵️ Only Unviewed: ${settings.onlyUnviewed?'ON':'OFF'}`, async b=>{ settings.onlyUnviewed=!settings.onlyUnviewed; b.innerText=`🕵️ Only Unviewed: ${settings.onlyUnviewed?'ON':'OFF'}`; await saveSettings(); applyFilter(); }));
    panel.appendChild(makeBtn(`🚫 Hide Hidden: ${settings.onlyUnhidden?'ON':'OFF'}`, async b=>{ settings.onlyUnhidden=!settings.onlyUnhidden; b.innerText=`🚫 Hide Hidden: ${settings.onlyUnhidden?'ON':'OFF'}`; await saveSettings(); applyFilter(); }));
    panel.appendChild(makeBtn(`📮 Hide Applied: ${settings.onlyUnapplied?'ON':'OFF'}`, async b=>{ settings.onlyUnapplied=!settings.onlyUnapplied; b.innerText=`📮 Hide Applied: ${settings.onlyUnapplied?'ON':'OFF'}`; await saveSettings(); applyFilter(); }));

    const phraseContainer = document.createElement('div');
    Object.assign(phraseContainer.style,{ display:'none', flexDirection:'column', gap:'4px' });
    panel.appendChild(phraseContainer);
    const phraseToggle = makeBtn('▶️ Blocked Phrases', b=>{
        const show = phraseContainer.style.display==='none';
        phraseContainer.style.display = show?'flex':'none';
        b.innerText = show?'🔽 Blocked Phrases':'▶️ Blocked Phrases';
    });
    panel.appendChild(phraseToggle);

    const phraseInput = document.createElement('input');
    phraseInput.placeholder = 'Block phrase...';
    Object.assign(phraseInput.style,{ padding:'4px', fontSize:'12px' });
    phraseContainer.appendChild(phraseInput);

    const listDiv = document.createElement('div');
    Object.assign(listDiv.style,{ display:'flex', flexDirection:'column', gap:'2px', maxHeight:'300px', overflowY:'auto' });
    phraseContainer.appendChild(listDiv);

    function renderPhraseList(){
        listDiv.innerHTML='';
        settings.blockedPhrases.forEach((p,i)=>{
            const row=document.createElement('div');
            Object.assign(row.style,{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'2px 4px', border:'1px solid #ccc', borderRadius:'4px' });
            const span=document.createElement('span'); span.innerText=p;
            const del=document.createElement('button'); del.innerText='❌'; Object.assign(del.style,{ background:'none', border:'none', cursor:'pointer' });
            del.onclick = async () => { settings.blockedPhrases.splice(i,1); await saveSettings(); renderPhraseList(); applyFilter(); };
            row.append(span, del);
            listDiv.append(row);
        });
    }
    const addPhraseBtn = makeBtn('➕ Add Phrase', async b=>{
        const v = phraseInput.value.trim();
        if(v && !settings.blockedPhrases.includes(v)){
            settings.blockedPhrases.push(v);
            await saveSettings(); renderPhraseList(); applyFilter(); openNextVisibleCard();
        }
        phraseInput.value='';
    });
    phraseContainer.appendChild(addPhraseBtn);
    renderPhraseList();

    document.head.appendChild(Object.assign(document.createElement('style'),{ textContent:`
        .block-phrase-btn{ display:none; background:transparent; border:none; cursor:pointer; font-size:12px; color:#000; border-radius:4px; padding:2px 6px; margin-left:4px; }
        .block-phrase-btn:hover{ background:#e6e6e6; }
        li[data-occludable-job-id]:hover .block-phrase-btn{ display:inline-block!important; }
    `}));

    function getVisibleCards(){ return Array.from(document.querySelectorAll('li[data-occludable-job-id]')).filter(li=>li.offsetParent!==null); }
    function openNextVisibleCard(cur){
        const visible = getVisibleCards(); let target;
        if(cur){ const idx = visible.indexOf(cur); if(idx>=0 && idx<visible.length-1) target = visible[idx+1]; }
        if(!target && visible.length) target = visible[0];
        if(target){ const link = target.querySelector('a.job-card-list__title--link'); if(link) link.click(); }
    }

    function applyFilter(){
        document.querySelectorAll('li[data-occludable-job-id]').forEach(card=>{
            const jobDiv = card.querySelector('div.job-card-container[data-job-id]'); if(!jobDiv) return;
            if(!card.querySelector('.block-phrase-btn')){
                const title = card.querySelector('a.job-card-list__title--link');
                const btn = document.createElement('button');
                btn.innerText='🚫'; btn.className='block-phrase-btn'; btn.title='Block this job title';
                btn.onclick = async e=>{ e.stopPropagation(); const str = title.querySelector('strong'); const ph = str?str.innerText.trim():title.innerText.trim(); if(!settings.blockedPhrases.includes(ph)){ settings.blockedPhrases.push(ph); await saveSettings(); renderPhraseList(); applyFilter(); openNextVisibleCard(card); } };
                const actions = card.querySelector('.job-card-list__actions-container');
                if(actions){ const closeDiv = actions.querySelector('div'); if(closeDiv) closeDiv.insertAdjacentElement('beforebegin', btn); else actions.insertBefore(btn, actions.firstChild); }
            }
            const dismiss = card.querySelector('button[aria-label*="Dismiss"]'); if(dismiss && !dismiss.dataset.next){ dismiss.dataset.next='1'; dismiss.onclick = ()=>{ openNextVisibleCard(card); }; }
            const text = jobDiv.innerText.toLowerCase();
            const isPromoted = !!jobDiv.querySelector('.job-card-container__footer-item--highlighted');
            const isViewed = text.includes('viewed');
            const isHidden = text.includes("we won’t show you this job") || text.includes("we won\u2019t show you this job");
            const isApplied = text.includes('applied');
            const blocked = settings.blockedPhrases.some(x=>text.includes(x.toLowerCase()));
            const isActive = jobDiv.getAttribute('aria-current')==='page';
            let vis = true;
            if(settings.onlyUnviewed && isViewed && !isActive) vis = false;
            if(settings.onlyUnhidden && isHidden) vis = false;
            if(settings.onlyUnapplied && isApplied) vis = false;
            if(blocked) vis = false;
            if(settings.activeFilter===FILTERS.SHOW_PROMOTED) vis = isPromoted;
            if(settings.activeFilter===FILTERS.SHOW_NORMAL) vis = !isPromoted;
            card.style.display = vis?'':'none';
        });
    }

    const observer = new MutationObserver(applyFilter);
    observer.observe(document.body,{ childList:true, subtree:true });
    applyFilter();
    openNextVisibleCard();
})();
