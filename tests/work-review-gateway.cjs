// Small gateway contract checks; uses a fake Supabase client and no network.
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const calls=[],writes=[];
 let raw={id:'change',request_type:'work_review_change',status:'pending',payload:{amount:10,__review:{action:'reverse',sourceId:'source',originalType:'customer_credit',date:'2026-11-13'}}};
 let response={data:null,error:{code:'PGRST202',message:'Could not find the function'}};
 const client={rpc:async(name,args)=>{calls.push({name,args});return response;},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:raw,error:null}),insert:()=>{writes.push('insert');throw Error('Unexpected non-atomic write');},update:()=>{writes.push('update');throw Error('Unexpected non-atomic update');}};return q;}};
 const window={__DUCESS_CONFIG__:{supabase:{url:'https://example.test',anonKey:'test'}},supabase:{createClient:()=>client}};
 runInNewContext(readFileSync(path.join(__dirname,'../src/data/runtime/ducess-gateway.js'),'utf8'),{window,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,Date,Map,Set,JSON});
 const g=window.DucessGateway.createSupabaseAdapter(window.__DUCESS_CONFIG__);
 const missing=await g.approvals.getWorkReviewContext('source');assert.equal(missing.ok,false);assert.match(missing.error.message,/migration/);
 const failed=await g.approvals.approveRequest({requestId:'change',approvedByStaffId:'officer',approvedByName:'Officer'});
 assert.equal(failed.ok,false);assert.equal(calls.at(-1).name,'ducess_commit_review_change');assert.equal(writes.length,0);
 console.log('PASS missing migration fails clearly; correction approval never falls back to separate writes');
 response={data:{...raw,status:'approved'},error:null};
 const done=await g.approvals.approveRequest({requestId:'change',approvedByStaffId:'officer',approvedByName:'Officer'});
 assert.equal(done.data.reviewAction,'reverse');assert.equal(done.data.reviewSourceId,'source');assert.equal(done.data.reviewOriginalType,'customer_credit');
 console.log('PASS approved correction retains its ownership/routing metadata for targeted refresh and balance projection');
 await g.approvals.submitWorkReviewAction({requestId:'source',action:'edit',patch:{amount:20},reason:'Fix amount',version:'v1',date:'2026-11-13'});
 assert.equal(calls.at(-1).name,'ducess_submit_review_action');assert.equal(calls.at(-1).args.p_version,'v1');assert.equal(writes.length,0);
 console.log('PASS submission uses one atomic RPC with a version guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
