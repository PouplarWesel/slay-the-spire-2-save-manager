const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Store,metadata,FILE}=require('../src/store.cjs');
const first='76561199112336060',second='76561199198785696';
const bytes=Buffer.from('{"acts":[],"current_act_index":0,"players":[{"character_id":"CHARACTER.REGENT","net_id":'+first+'},{"character_id":"CHARACTER.SILENT","net_id":'+second+'}]}');
test('Steam IDs keep all 64-bit digits when save JSON stores them as numbers',()=>{
 assert.deepEqual(metadata(bytes).players.map(p=>p.steamId),[first,second]);
});
test('resolved Steam names are cached separately and do not change save payloads',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'spire-names-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const saves=path.join(root,'steam','123','profile1','saves');fs.mkdirSync(saves,{recursive:true});fs.writeFileSync(path.join(saves,FILE),bytes);
 const cloud={context:()=>({}),names:()=>({[first]:'Player One',[second]:'Player Two','76561190000000000':'Unrequested'})};
 const options={dataDir:path.join(root,'library'),saveRoot:path.join(root,'steam'),cloud};
 const store=new Store(options);store.state();store.capture({name:'Party'});
 const state=store.resolveNames();assert.equal(state.slots[0].metadata.players[0].steamName,'Player One');assert.equal(state.personaNames['76561190000000000'],undefined);
 assert.deepEqual(store.verify('slots',store.db.slots[0])[FILE],bytes);
 const offline=new Store({...options,cloud:null});assert.equal(offline.state().slots[0].metadata.players[1].steamName,'Player Two');
});
test('existing saved metadata is upgraded from original bytes without rounding player IDs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'spire-names-upgrade-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const saves=path.join(root,'steam','123','profile1','saves');fs.mkdirSync(saves,{recursive:true});fs.writeFileSync(path.join(saves,FILE),bytes);
 const opts={dataDir:path.join(root,'library'),saveRoot:path.join(root,'steam')};const store=new Store(opts);store.state();store.capture({name:'Existing'});
 for(const p of store.db.slots[0].metadata.players)delete p.steamId;store.persist();
 const reopened=new Store(opts);assert.equal(reopened.state().slots[0].metadata.players[0].steamId,first);
 assert.deepEqual(reopened.verify('slots',reopened.db.slots[0])[FILE],bytes);
});
