const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {NAMES, hash} = require('./store.cjs');
const encode = files => Object.fromEntries(Object.entries(files).map(([n,b])=>[n,b.toString('base64')]));
function validate(snapshot) {
  if (!snapshot || typeof snapshot.enabled !== 'boolean' || !snapshot.files || typeof snapshot.files !== 'object') throw new Error('Invalid Steam Cloud response.');
  for (const [n,b] of Object.entries(snapshot.files)) {
    if (!NAMES.includes(n) || typeof b !== 'string' || Buffer.from(b,'base64').length > 32*1024*1024) throw new Error('Invalid Steam multiplayer file.');
  }
  return snapshot;
}
function hashes(snapshot) { return Object.fromEntries(Object.entries(snapshot.files).map(([n,b])=>[n,hash(Buffer.from(b,'base64'))])); }
function same(a,b) { return NAMES.every(n=>(a.files[n]??null)===(b.files[n]??null)); }
class SteamCloud {
  constructor({helperPath=path.join(__dirname,'steam-helper.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1'),invoke=execFileSync,dllPath}={}) { this.helperPath=helperPath;this.invoke=invoke;this.dllPath=dllPath; }
  context(profile) {
    const normalized = path.resolve(profile).replace(/\\/g,'/');
    const match = normalized.match(/\/SlayTheSpire2\/steam\/(7656119\d{10})\/((?:modded\/)?profile\d+\/saves)$/i);
    if (!match) return null;
    return {steamId:match[1],profileKey:match[2]};
  }
  findDll() {
    if (this.dllPath && fs.existsSync(this.dllPath)) return this.dllPath;
    const candidates = [];
    try {
      const out=this.invoke('reg.exe',['query','HKCU\\Software\\Valve\\Steam','/v','SteamPath'],{encoding:'utf8',windowsHide:true,timeout:5000});
      const m=out.match(/SteamPath\s+REG_SZ\s+(.+)/i);if(m)candidates.push(m[1].trim());
    } catch {}
    candidates.push(path.join(process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)','Steam'));
    for (const steam of [...candidates]) {
      const config=path.join(steam,'steamapps','libraryfolders.vdf');
      try { const vdf=fs.readFileSync(config,'utf8'); for(const m of vdf.matchAll(/"path"\s+"((?:\\.|[^"\\])*)"/g))candidates.push(m[1].replace(/\\\\/g,'\\')); } catch {}
    }
    for(const library of new Set(candidates)) {
      const dll=path.join(library,'steamapps','common','Slay the Spire 2','data_sts2_windows_x86_64','steam_api64.dll');
      if(fs.existsSync(dll)){this.dllPath=dll;return dll;}
    }
    throw new Error('Cannot find the game’s Steam library. Install Slay the Spire 2 in a Steam library before swapping saves.');
  }
  request(profile,action,more={}) {
    const context=this.context(profile);if(!context)return {enabled:false,files:{},customProfile:true};
    let output;
    try {
      output=this.invoke('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.helperPath],{input:JSON.stringify({...context,action,dllPath:this.findDll(),...more}),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:100*1024*1024});
    } catch(e) {
      const error=new Error('Steam Cloud could not be verified. Keep Steam open and the game closed, then try again.');
      error.cloudUncertain=action==='apply';throw error;
    }
    const line=output.split(/\r?\n/).filter(l=>l.startsWith('SPIREKEEPER_RESULT=')).pop();
    if(!line){const e=new Error('Steam did not return a verified save result.');e.cloudUncertain=action==='apply';throw e;}
    let result;try{result=JSON.parse(line.slice(19));}catch{const e=new Error('Steam returned an unreadable save result.');e.cloudUncertain=action==='apply';throw e;}
    if(!result.ok){const e=new Error(result.error||'Steam rejected the save operation.');e.cloudUncertain=Boolean(result.needsRecovery);throw e;}
    if(result.steamId!==context.steamId)throw new Error('Steam account does not match the selected game profile.');
    if(action==='names')return {names:result.names||{}};
    return validate({...result,profileKey:context.profileKey});
  }
  read(profile) {return this.request(profile,'read');}
  names(profile,ids) {return this.request(profile,'names',{ids}).names||{};}
  apply(profile,files,expected) {
    const context=this.context(profile);
    if(!context||expected.steamId!==context.steamId||expected.profileKey!==context.profileKey)throw new Error('Steam backup does not match this profile.');
    const result=this.request(profile,'apply',{files:encode(files),expected:expected.files});
    if(!same(result,{files:encode(files)})){const e=new Error('Steam save did not match the requested swap.');e.cloudUncertain=true;throw e;}
    return result;
  }
}
module.exports={SteamCloud,encode,validate,hashes,same};
