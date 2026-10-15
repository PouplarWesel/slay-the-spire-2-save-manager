// Restore verified library data into the filesystem view of the normal Windows app.
// This never loads/unloads a game save and never invokes Steam Cloud.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {Store,hash}=require('../src/store.cjs');
(async()=>{
 const appData=process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming');
 const source=new Store({dataDir:path.join(appData,'Spirekeeper'),saveRoot:path.join(appData,'SlayTheSpire2','steam')});
 const files=[];
 for(const type of ['slots','backups'])for(const record of source.db[type]){
  source.verify(type,record);
  if(type==='backups'&&record.cloud)source.cloudBackup(record);
  for(const name of ['current_run_mp.save','current_run_mp.save.backup','manifest.json',...(record.cloud?['steam-cloud.json']:[])]){
   const p=path.join(source.folder(type,record.id),name);if(!fs.existsSync(p))continue;
   const bytes=fs.readFileSync(p);files.push({type,id:record.id,name,bytes:bytes.toString('base64'),hash:hash(bytes)});
  }
 }
 const bundle={index:source.db,files};
 if(!bundle.index.slots.some(s=>s.name==='Evan, Daniel'))throw Error('Verified source run not found.');
 const list=await(await fetch('http://127.0.0.1:9223/json/list')).json();
 const ws=new WebSocket(list[0].webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const restore=function(bundle){
  const fs=process.mainModule.require('node:fs'),path=process.mainModule.require('node:path'),crypto=process.mainModule.require('node:crypto');
  const {Store}=process.mainModule.require('./store.cjs');
  const dir=path.join(process.env.APPDATA,'Spirekeeper');
  const target=new Store({dataDir:dir,saveRoot:path.join(process.env.APPDATA,'SlayTheSpire2','steam')});
  const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
  if(fs.existsSync(target.indexPath))fs.copyFileSync(target.indexPath,path.join(dir,'index.before-library-restore-'+crypto.randomUUID()+'.json'));
  for(const f of bundle.files){
   if(!['slots','backups'].includes(f.type)||!['current_run_mp.save','current_run_mp.save.backup','manifest.json','steam-cloud.json'].includes(f.name))throw Error('Unexpected recovery file.');
   const bytes=Buffer.from(f.bytes,'base64');if(digest(bytes)!==f.hash)throw Error('Recovery payload checksum failed.');
   const folder=target.folder(f.type,f.id);fs.mkdirSync(folder,{recursive:true});const dest=path.join(folder,f.name);
   if(fs.existsSync(dest)){if(fs.lstatSync(dest).isSymbolicLink()||digest(fs.readFileSync(dest))!==f.hash)throw Error('An existing recovery file differs; left untouched.');continue;}
   const fd=fs.openSync(dest,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  for(const type of ['slots','backups'])for(const record of bundle.index[type]){
   target.verify(type,record);if(record.cloud)target.cloudBackup(record);
   if(!target.db[type].some(r=>r.id===record.id))target.db[type].push(record);
  }
  target.db.profile=bundle.index.profile;target.persist();
  return {libraryPath:dir,savedRuns:target.db.slots.map(s=>s.name),backupCount:target.db.backups.length};
 };
 const expression='JSON.stringify(('+restore.toString()+')('+JSON.stringify(bundle)+'))';
 const result=await new Promise(resolve=>{ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)resolve(m);});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
 ws.close();if(result.result?.exceptionDetails)throw Error(JSON.stringify(result.result.exceptionDetails));
 console.log(result.result.result.value);
})().catch(e=>{console.error(e);process.exitCode=1;});
