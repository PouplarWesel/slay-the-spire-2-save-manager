const fs=require('node:fs');
(async()=>{
 const list=await (await fetch('http://127.0.0.1:9223/json/list')).json();
 const ws=new WebSocket(list[0].webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const expression=`JSON.stringify((()=>{const fs=process.mainModule.require('node:fs'),os=process.mainModule.require('node:os'),path=process.mainModule.require('node:path');const dir=path.join(process.env.APPDATA,'Spirekeeper');const p=path.join(dir,'index.json');const j=JSON.parse(fs.readFileSync(p,'utf8'));return{user:os.userInfo().username,env:process.env.APPDATA,exe:process.execPath,main:process.mainModule.filename,dir,real:fs.realpathSync.native(dir),names:fs.readdirSync(dir),index:{profile:j.profile,slots:j.slots.length,backups:j.backups.length},stat:{ino:fs.statSync(p).ino,size:fs.statSync(p).size}}})())`;
 const result=await new Promise(resolve=>{ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id===1)resolve(m);});ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));});
 console.log(JSON.stringify(result,null,2));ws.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
