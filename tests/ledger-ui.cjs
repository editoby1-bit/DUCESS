// Run: node tests/ledger-ui.cjs (requires Playwright and Chromium).
// Uses synthetic data and blocks external requests; never contacts Supabase.
const { chromium } = require('playwright');
const { readFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assert = require('node:assert/strict');
const configContext={window:{}};
require('node:vm').runInNewContext(readFileSync(path.join(root,'src/data/runtime/ducess-config.js'),'utf8'),configContext);
const txColumns=configContext.window.__DUCESS_CONFIG__.supabase.customerTransactionsSelect.split(',').map(c=>c.trim());
for(const c of ['posted_by','posted_by_id','approved_by','counterparty','details','balance_after'])assert(txColumns.includes(c),`Missing statement column ${c}`);
console.log('PASS Configured transaction reads preserve statement attribution');
(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1', '--directory', root], {stdio:'ignore'});
  let browser;
  try {
    for (let n=0; n<30; n++) {
      try { if ((await fetch('http://127.0.0.1:8765/')).ok) break; } catch {}
      await new Promise(r=>setTimeout(r,100));
    }
    browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (url.pathname === '/app.js') {
        let source=readFileSync(path.join(root,'app.js'),'utf8');
        const marker="  if (document.readyState === 'loading') {";
        assert(source.includes(marker));
        source=source.slice(0,source.lastIndexOf(marker))+`window.__test={state,gateway,renderModules,renderStaffReview,bindStaffReview,staffReviewRows,renderPeriodBalance,renderApprovals,renderAccountStatement,openCustomerSearchModal,sortedSearchAccounts,renderJournalRegister,bindJournalRegister,renderJournalPaneMarkup,validateJournalDate,tellerIdLabel,businessDate,bindJournal,reviewToolFor,hydrateStatementAttribution,openWorkReviewAction,postingApprovals,getStaffOperationalBreakdown,syncOperationalEffectsFromApprovedRequests};\n})();`;
        return route.fulfill({contentType:'application/javascript',body:source});
      }
      if (url.pathname.endsWith('/ducess-config.js')) return route.fulfill({contentType:'application/javascript',body:'window.__DUCESS_CONFIG__={useSupabaseBackend:false};'});
      if (url.pathname.endsWith('/ducess-gateway.js')) {
        const source=readFileSync(path.join(root,'src/data/runtime/ducess-gateway.js'),'utf8');
        return route.fulfill({contentType:'application/javascript',body:source+'\nwindow.DucessGateway.createGateway=window.DucessGateway.createLocalAdapter;'});
      }
      return route.continue();
    });
    await page.goto('http://127.0.0.1:8765/');
    assert.deepEqual(errors, []);
    await page.evaluate(() => {
      const t=window.__test,s=t.state;
      s.staff=[{id:'admin',staffId:'ADMIN-9',name:'Admin',role:'admin_officer'},{id:'cs',staffId:'CS-007',name:'Clara',role:'customer_service'},{id:'teller',staffId:'TELL-042',name:'Tina',role:'teller'}];
      s.activeStaffId='admin';s.customers=[];s.approvals=[];s.journals=[];s.audit=[];s.cod=[];s.ui.reviewFilters={};s.ui.balancePeriodFilter={preset:'all'};
      const at=t.businessDate()+'T12:00:00Z';
      s.approvals=[{id:'cs-work',type:'account_opening',requestedBy:'cs',requestedByName:'Clara',requestedAt:at,status:'approved',approvedBy:'Officer',payload:{accountNumber:'2',name:'Customer Two',address:'Road Two',phone:'0800',nin:'123',bvn:'456'}},{id:'admin-work',type:'account_opening',requestedBy:'admin',requestedByName:'Admin',requestedAt:at,status:'pending',payload:{name:'Admin Customer'}}];
      s.audit=[{actorId:'cs',at,action:'login',details:'Do not show this'}];
    });
    const check=async(name,fn)=>{await page.evaluate(fn);console.log('PASS',name);};
    await check('Exact staff ID stays in dashboard tools',()=>{const t=__test;t.state.activeStaffId='teller';t.renderModules();if(!document.querySelector('#moduleGrid .dashboard-staff-id').textContent.includes('TELL-042'))throw Error('identity');});
    await check('Account search groups types and sorts account numbers naturally',()=>{const t=__test;const list=[{id:'e',accountType:'expense',accountNumber:'E1',name:'Expense'},{id:'10',accountNumber:'10',name:'Ten'},{id:'s',accountType:'staff_salary',accountNumber:'S1',name:'Staff'},{id:'2',accountNumber:'2',name:'Two'},{id:'i',accountType:'income',accountNumber:'I1',name:'Income'}];t.openCustomerSearchModal(list);if(document.querySelector('#modalTitle').textContent!=='Account Search')throw Error('title');const nums=[...document.querySelectorAll('#modalCustomerRows tr')].map(r=>r.cells[0].textContent);if(nums.join(',')!=='2,10,S1,I1,E1')throw Error(nums);});
    await check('Admin reviews selected staff with account details and no activity log',()=>{const t=__test;t.state.activeStaffId='admin';t.state.ui.reviewStaffId='cs';const html=t.renderStaffReview('work_review');if(!html.includes('Customer Two')||!html.includes('Road Two')||html.includes('Admin Customer')||html.includes('Do not show this')||html.includes('<th>Activity</th>'))throw Error('staff review scope');t.state.activeStaffId='cs';t.state.ui.reviewStaffId='admin';if(t.renderStaffReview('work_review').includes('Admin Customer'))throw Error('non-admin scope');});
    await check('Balance tables have five columns and teller report excludes other staff',()=>{const t=__test;t.state.customers=[{id:'tc',accountType:'staff_operational',linkedStaffId:'teller',accountNumber:'T2',name:'Tina',balance:0},{id:'ac',accountType:'staff_operational',linkedStaffId:'admin',accountNumber:'T1',name:'Admin Account',balance:0}];const d=document.createElement('div');d.innerHTML=t.renderPeriodBalance({report:'tellers',label:'Teller Balance',preset:'all'});const h=[...d.querySelectorAll('th')].map(x=>x.textContent).join(',');if(h!=='S/N,Account Number,Details,Credit,Balance'||d.textContent.includes('Admin Account')||!d.textContent.includes('Tina'))throw Error(h);});
    await check('Statement shows received, posted and approved names',()=>{const t=__test;t.state.customers=[{id:'c',name:'Customer',accountNumber:'2',transactions:[{id:'tx',date:t.businessDate(),type:'credit',amount:20,balanceAfter:20,receivedOrPaidBy:'Depositor',postedBy:'Tina',approvedBy:'Officer'}]}];t.state.ui.selectedCustomerId='c';t.state.ui.accountStatementGenerated=true;const html=t.renderAccountStatement();for(const name of ['Depositor','Tina','Officer'])if(!html.includes(name))throw Error(name);});
    await check('Journal date accepts a chosen date beyond business date',()=>{if(__test.validateJournalDate('2090-01-02')!==''||!__test.validateJournalDate(''))throw Error('date validation');});
    await check('Journal register sorts oldest first and View opens',()=>{const t=__test;t.state.activeStaffId='teller';t.state.journals=[{id:'j2',journalNumber:'JN2',kind:'credit',staffId:'teller',staffName:'Tina',status:'sent',createdAt:'2026-11-13T12:00:00Z',rows:[]},{id:'j1',journalNumber:'JN1',kind:'credit',staffId:'teller',staffName:'Tina',status:'sent',createdAt:'2026-11-12T12:00:00Z',rows:[]}];t.state.approvals=[];document.querySelector('#workspace').innerHTML=t.renderJournalRegister();t.bindJournalRegister();const html=document.querySelector('#workspace').innerHTML;if(html.indexOf('JN1')>html.indexOf('JN2'))throw Error('order');document.querySelector('[data-journal-view="j1"]').click();if(document.querySelector('#modalTitle').textContent!=='JN1'||document.querySelector('#modalBack').classList.contains('hidden'))throw Error('view');});
    await check('New journal entries append below existing rows; date stays editable',()=>{
      const t=__test,s=t.state;s.activeStaffId='teller';s.ui.module='tellering';s.ui.tool='journal_credit';
      const key=`teller:${t.businessDate()}:credit`;s.ui.generatedJournals={[key]:true};s.ui.staffJournals={};s.ui.telleringDrafts={};
      s.customers=[{id:'one',name:'First',accountNumber:'1',active:true,createdAt:new Date().toISOString(),balance:0,transactions:[]},{id:'two',name:'Second',accountNumber:'2',active:true,createdAt:new Date().toISOString(),balance:0,transactions:[]}];
      document.querySelector('#workspace').innerHTML=t.renderJournalPaneMarkup('credit');t.bindJournal('credit');
      const date=document.querySelector('#journalDate');if(!date||date.disabled||date.readOnly||date.max)throw Error('journal date locked');
      for(const num of ['1','2']){document.querySelector('#journalAcc').value=num;document.querySelector('#journalAmount').value='10';document.querySelector('#journalAddRow').click();}
      const rows=[...document.querySelectorAll('#journalRows tr')];if(rows.length!==2||rows[0].cells[1].textContent!=='1'||rows[1].cells[1].textContent!=='2'||rows[1].cells[0].textContent!=='2')throw Error('append order');
    });
    await check('Approval queue omits daily COD status',()=>{const t=__test;t.state.activeStaffId='admin';t.state.ui.tool='approval_tellering';if(t.renderApprovals().includes('COD Daily Submission Status'))throw Error('COD status still visible');});
    await check('Admin role navigation matches each staff review',()=>{const t=__test;if(t.reviewToolFor(t.state.staff.find(s=>s.id==='teller'))!=='teller_review'||t.reviewToolFor({role:'approving_officer'})!=='approval_review')throw Error('role review navigation');});
    await check('Old cached statement attribution uses bounded one-time batches',async()=>{
      const t=__test,g=t.gateway,oldMeta=g.__meta,oldHistory=g.history,oldApprovals=g.approvals;const calls=[];
      g.__meta={adapter:'supabase'};g.approvals={};g.history={transactionsByIds:async ids=>{calls.push(ids.length);return {ok:true,data:ids.map(id=>({customerId:'cached',tx:{id,postedBy:'Poster',approvedBy:'Officer',counterparty:'Depositor'}}))};}};
      const c={id:'cached',transactions:Array.from({length:205},(_,i)=>({id:`cached-${i}`,date:t.businessDate(),type:'credit',amount:1}))};t.state.ui.tool=null;
      try{await t.hydrateStatementAttribution(c,{});await t.hydrateStatementAttribution(c,{});if(calls.join(',')!=='100,100,5'||c.transactions[204].approvedBy!=='Officer')throw Error('cache batching '+calls);}finally{g.__meta=oldMeta;g.history=oldHistory;g.approvals=oldApprovals;}
    });
    await check('Journal View remains open when attachment retrieval fails',async()=>{
      const t=__test,g=t.gateway,oldMeta=g.__meta,oldApprovals=g.approvals,oldJournals=g.journals;
      g.__meta={adapter:'supabase'};g.approvals={};g.journals={list:()=>new Promise(()=>{}),epoch:()=>new Promise(()=>{}),get:async()=>{throw Error('offline attachment');}};
      t.state.activeStaffId='teller';t.state.journals=[{id:'attachment',journalNumber:'JN3',staffId:'teller',status:'sent',hasFieldNote:true,rows:[]}];
      try{document.querySelector('#workspace').innerHTML=t.renderJournalRegister();t.bindJournalRegister();document.querySelector('[data-journal-view="attachment"]').click();await new Promise(r=>setTimeout(r,0));if(document.querySelector('#modalTitle').textContent!=='JN3'||document.querySelector('#modalBack').classList.contains('hidden'))throw Error('attachment blocked journal');}finally{g.__meta=oldMeta;g.approvals=oldApprovals;g.journals=oldJournals;}
    });
    await check('Staff work-review View cannot approve or reject its own request',async()=>{
      const t=__test,s=t.state;s.activeStaffId='cs';s.ui.tool='work_review';s.approvals=[{id:'pending-own',type:'account_maintenance',requestedBy:'cs',requestedAt:t.businessDate()+'T12:00:00Z',status:'pending',payload:{accountNumber:'2',patch:{name:'Pending Name'}}}];
      document.querySelector('#workspace').innerHTML=t.renderStaffReview('work_review');t.bindStaffReview();document.querySelector('[data-review-request="pending-own"]').click();await new Promise(r=>setTimeout(r,0));const actions=document.querySelector('#modalActions').textContent;if(actions.includes('Approve')||actions.includes('Reject')||!actions.includes('Close'))throw Error(actions);
    });
    await check('Work Review Edit and Reverse buttons open functional, reason-required dialogs',async()=>{
      const t=__test,s=t.state,g=t.gateway,oldApprovals=g.approvals,calls=[];
      s.activeStaffId='cs';s.ui.module='customer_service';s.ui.tool='work_review';s.ui.reviewStaffId='cs';
      s.approvals=[{id:'own-edit',type:'customer_credit',requestedBy:'cs',requestedByStaffId:'cs',requestedAt:t.businessDate()+'T12:00:00Z',status:'approved',payload:{amount:10,details:'Original'}}];
      g.approvals={...oldApprovals,getWorkReviewContext:async()=>({ok:true,data:{type:'customer_credit',status:'approved',payload:{amount:10,details:'Original'},version:'v1'}}),submitWorkReviewAction:async input=>{calls.push(input);await new Promise(r=>setTimeout(r,10));return {ok:true,data:{id:'change'}};}};
      try {
        document.querySelector('#workspace').innerHTML=t.renderStaffReview('work_review');t.bindStaffReview();
        if(document.querySelector('[data-review-edit]').disabled||document.querySelector('[data-review-reverse]').disabled)throw Error('buttons disabled');
        await t.openWorkReviewAction('own-edit','edit');
        const submit=[...document.querySelectorAll('#modalActions button')].find(b=>b.textContent==='Send for Approval');submit.click();await new Promise(r=>setTimeout(r,0));if(calls.length)throw Error('reason not enforced');
        document.querySelector('[data-review-field="amount"]').value='25';document.querySelector('#reviewActionReason').value='Correct the amount';submit.click();submit.click();await new Promise(r=>setTimeout(r,80));
        if(calls.length!==1||calls[0].patch.amount!==25||calls[0].version!=='v1')throw Error('edit not submitted once');
        await t.openWorkReviewAction('own-edit','reverse');document.querySelector('#reviewActionReason').value='Duplicate posting';document.querySelector('#modalActions .danger').click();await new Promise(r=>setTimeout(r,80));
        if(calls.length!==2||calls[1].action!=='reverse'||Object.keys(calls[1].patch).length)throw Error('reverse submission');
      } finally {g.approvals=oldApprovals;}
    });
    await check('Correction projections preserve old dates and offset amounts without altering stored work',()=>{
      const t=__test,s=t.state;
      const original={id:'source',type:'customer_credit',status:'approved',payload:{amount:100,staffId:'teller',date:'2026-11-12'}};
      s.approvals=[original,{id:'correction',type:'work_review_change',status:'approved',reviewAction:'edit',payload:{amount:80,staffId:'teller',date:'2026-11-13',__review:{action:'edit',sourceId:'source',originalType:'customer_credit',date:'2026-11-13',originalPayload:original.payload}}}];
      const events=t.postingApprovals();
      if(events.length!==3||events[0].payload.date!=='2026-11-12'||events[1].type!=='customer_debit'||events[1].payload.date!=='2026-11-13'||events[2].payload.amount!==80||s.approvals.length!==2)throw Error('correction projection');
      const net=events.reduce((v,r)=>v+(r.type==='customer_credit'?1:-1)*r.payload.amount,0);if(net!==80)throw Error('incorrect net '+net);
    });
    await check('Fee reversals offset income once without deleting historical entries',()=>{
      const t=__test,s=t.state,original={amount:20,customerCreditAmount:18,totalChargeAmount:2,chargeBreakdown:[{key:'commission',label:'Commission',accountName:'Commission',amount:2}],date:'2026-11-12',accountNumber:'1'};
      s.operations={incomeAccounts:[{id:'fee-account',name:'Commission',accountNumber:'I1'}],expenseAccounts:[],entries:[]};
      s.approvals=[{id:'fee-source',type:'customer_credit',status:'approved',payload:original},{id:'fee-reverse',type:'work_review_change',status:'approved',reviewAction:'reverse',payload:{...original,__review:{action:'reverse',sourceId:'fee-source',originalType:'customer_credit',date:'2026-11-13'}}}];
      t.syncOperationalEffectsFromApprovedRequests();t.syncOperationalEffectsFromApprovedRequests();
      if(s.operations.entries.length!==2||s.operations.entries.reduce((sum,e)=>sum+e.amount,0)!==0)throw Error('fee reversal duplicated or missing');
    });
    await check('Corrections appear in the original task approval queue with their reason',()=>{
      const t=__test,s=t.state;s.activeStaffId='admin';s.ui.tool='appr_direct';s.ui.approvalsSection='tellering';
      s.approvals=[{id:'pending-correction',type:'work_review_change',status:'pending',requestedBy:'teller',requestedByName:'Tina',requestedAt:t.businessDate()+'T12:00:00Z',reviewAction:'reverse',reviewOriginalType:'customer_credit',reviewSourceId:'source',payload:{amount:20,date:t.businessDate(),__review:{reason:'Duplicate deposit'}}}];
      const html=t.renderApprovals();for(const text of ['REVERSE','Duplicate deposit','View Change'])if(!html.includes(text))throw Error(text+' missing from correction queue');
    });
    assert.deepEqual(errors,[]);
    console.log('All browser regressions passed; no remote requests were permitted.');
  } finally {await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
