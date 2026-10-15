// Live diagnostic: reads saves by default. --unload explicitly parks the active run.
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {Store}=require('../src/store.cjs');
const {SteamCloud}=require('../src/steam-cloud.cjs');
const appData=process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming');
const running=()=>Boolean(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-Process | Where-Object { $_.ProcessName -match "^(sts2|SlayTheSpire2)$" } | Select-Object -ExpandProperty ProcessName'],{encoding:'utf8',windowsHide:true,timeout:8000}).trim());
const store=new Store({dataDir:path.join(appData,'Spirekeeper'),saveRoot:path.join(appData,'SlayTheSpire2','steam'),cloud:new SteamCloud(),isGameRunning:running});
if(process.argv.includes('--unload'))store.unload();
const state=store.state(),cloud=store.cloud.read(state.profile);
console.log(JSON.stringify({profile:state.profile,localPresent:Boolean(state.current),cloudEnabled:cloud.enabled,cloudFiles:Object.keys(cloud.files),savedRuns:state.slots.map(s=>s.name),recoveryPoints:state.backups.length,recoveryRequired:state.recoveryRequired},null,2));
