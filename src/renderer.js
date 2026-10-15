const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>new Date(v).toLocaleString();
let state,busy=false,selected=null,selectedBackup=null,modalAction,search='';
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
async function call(action,payload,message,quiet=false){
  if(busy)return false;busy=true;
  try{if(['load','unload','restore'].includes(action)||(action==='capture'&&payload?.unload))status('Updating saves…');const r=await window.spire.call(action,payload);if(!r.ok)throw Error(r.error);state=r.state;render();if(message)status(typeof message==='function'?message(state):message);return true;}
  catch(e){if(!quiet)status(e.message,true);return false;}
  finally{busy=false;}
}
const characters=m=>(m?.players||[]).map(p=>{const character=p.character.toLowerCase().replace(/(^|_)(\w)/g,(_,a,b)=>' '+b.toUpperCase()).trim();return p.steamName?p.steamName+' ('+character+')':character;}).join(', ');
function render(){
  if(!state)return;
  const c=state.current,locked=state.gameRunning||state.recoveryRequired;
  const loaded=state.loaded?.profile===state.profile?state.slots.find(s=>s.id===state.loaded.id):null;
  $('activeTitle').textContent=c?.invalid?'Unreadable multiplayer save':c?'Current run'+(loaded?' - '+loaded.name:''):state.profile?'No active multiplayer run':'Choose your game save folder';
  $('activeDetails').textContent=c?.invalid?c.error:c?'Act '+c.act+' · Ascension '+c.ascension+' · '+characters(c)+' · Saved '+date(c.modified):state.profile?'Load a saved run or start a new multiplayer run in the game.':'Select a detected profile above, or browse to its saves folder.';
  $('gameStatus').textContent=state.gameRunning?'Game running - close it to swap':'Game closed';
  $('capture').disabled=locked||!c||c.invalid;$('unload').disabled=locked||!c;$('openProfile').disabled=!state.profile;
  $('recoveryBanner').hidden=!state.recoveryRequired;
  const profiles=state.profiles;$('profiles').innerHTML='<option value="">Choose a profile…</option>'+profiles.map(p=>'<option value="'+esc(p.path)+'">'+esc(p.path)+'</option>').join('')+(!profiles.some(p=>p.path===state.profile)&&state.profile?'<option value="'+esc(state.profile)+'">'+esc(state.profile)+'</option>':'');$('profiles').value=state.profile;$('libraryPath').value=state.libraryPath;
  $('slotCount').textContent=state.slots.length;$('backupCount').textContent=state.backups.length;
  const filtered=state.slots.filter(s=>(s.name+' '+s.notes+' '+characters(s.metadata)).toLowerCase().includes(search.toLowerCase()));
  if(!filtered.some(s=>s.id===selected))selected=filtered[0]?.id||null;
  if(!state.backups.some(b=>b.id===selectedBackup))selectedBackup=state.backups[0]?.id||null;
  $('saveList').innerHTML=filtered.length?filtered.map(s=>'<button class="list-row '+(s.id===selected?'selected':'')+'" role="option" aria-selected="'+(s.id===selected)+'" data-slot="'+s.id+'"><strong>'+esc(s.name)+(loaded?.id===s.id?' (in game)':'')+'</strong><small>'+esc(characters(s.metadata))+'</small><small>Act '+esc(s.metadata.act)+' · '+s.metadata.players.length+' players · '+date(s.updated)+'</small></button>').join(''):'<div class="empty">'+(search?'No matching saves.':'No saved runs yet.<br>Save the current run or import a save file.')+'</div>';
  $('backupList').innerHTML=state.backups.length?state.backups.map(b=>'<button class="list-row '+(b.id===selectedBackup?'selected':'')+'" role="option" aria-selected="'+(b.id===selectedBackup)+'" data-backup="'+b.id+'"><strong>'+date(b.created)+'</strong><small>'+esc(b.reason)+'</small></button>').join(''):'<div class="empty">No backups yet.<br>Loading or unloading a run creates one.</div>';
  const s=state.slots.find(s=>s.id===selected),b=state.backups.find(b=>b.id===selectedBackup);
  $('load').disabled=locked||!s||!state.profile;$('update').disabled=locked||!s||!c||c.invalid;
  for(const id of ['export','edit','remove'])$(id).disabled=!s;
  $('restore').disabled=locked||!b||b.profile!==state.profile;
  $('selectionDetails').textContent=s?s.name+' - Act '+s.metadata.act+', Ascension '+s.metadata.ascension+' - '+characters(s.metadata)+(s.notes?'\n'+s.notes:''):'Select a saved run to see its details.';
}
function openModal({title,description,fields=false,name='',notes='',submit='Continue',alternate=false,action}){
  modalAction=action;$('modalTitle').textContent=title;$('modalDescription').textContent=description;$('modalFields').hidden=!fields;$('name').required=fields;$('name').value=name;$('notes').value=notes;$('modalSubmit').textContent=submit;$('alternateSubmit').hidden=!alternate;$('modal').showModal();(fields?$('name'):$('modalSubmit')).focus();
}
function confirmAction(action,id){
  const s=state.slots.find(s=>s.id===id);
  const titles={load:'Load saved run',unload:'Load out current run',restore:'Restore backup',updateSlot:'Update saved run',remove:'Remove saved run'};
  const descriptions={load:'Load “'+s?.name+'” into the game? The current run will be backed up. This also updates the multiplayer copy in Steam Cloud.',unload:'Clear the multiplayer slot locally and in Steam Cloud? Both copies will be kept in Automatic backups so the old run will not return at launch.',restore:'Restore this backup locally and in Steam Cloud? Your current multiplayer run will be backed up first.',updateSlot:'Update “'+s?.name+'” with the current game save? The old snapshot will be kept in the storage folder’s trash.',remove:'Remove “'+s?.name+'” from the list? Its files will be kept in the storage folder’s trash. The current game save is unaffected.'};
  openModal({title:titles[action],description:descriptions[action],submit:titles[action],action:()=>call(action,id,result=>['load','unload','restore'].includes(action)&&result.lastCloudSync?.profile===result.profile?'Done - local save and Steam Cloud updated.':'Done.')});
}
async function submitModal(alternate=false){if(busy||!modalAction||!$('modalForm').reportValidity())return;const ok=await modalAction(alternate);if(ok)$('modal').close();}
$('modalForm').addEventListener('submit',e=>{e.preventDefault();submitModal();});$('alternateSubmit').addEventListener('click',()=>submitModal(true));$('cancelModal').addEventListener('click',()=>$('modal').close());
$('capture').addEventListener('click',()=>openModal({title:'Save current run',description:'Name this multiplayer run. Save & load out also clears its local and Steam Cloud slot.',fields:true,submit:'Save',alternate:true,action:unload=>call('capture',{name:$('name').value,notes:$('notes').value,unload},result=>unload?(result.lastCloudSync?'Run saved and loaded out locally and from Steam Cloud.':'Run saved and loaded out.'):'Run saved.')}));
$('unload').addEventListener('click',()=>confirmAction('unload'));
$('load').addEventListener('click',()=>confirmAction('load',selected));$('update').addEventListener('click',()=>confirmAction('updateSlot',selected));$('remove').addEventListener('click',()=>confirmAction('remove',selected));$('restore').addEventListener('click',()=>confirmAction('restore',selectedBackup));
$('edit').addEventListener('click',()=>{const s=state.slots.find(s=>s.id===selected);if(!s)return;openModal({title:'Rename / notes',description:'Edit the saved run’s name and notes.',fields:true,name:s.name,notes:s.notes,submit:'Save',action:()=>call('edit',{id:s.id,name:$('name').value,notes:$('notes').value},'Saved run updated.')});});
for(const [id,action]of [['import','import'],['browse','browse'],['openLibrary','openLibrary'],['openProfile','openProfile'],['launch','launch'],['recover','recover']])$(id).addEventListener('click',()=>call(action));
$('refresh').addEventListener('click',async()=>{if(await call('state'))await call('resolveNames',null,null,true);});
$('export').addEventListener('click',()=>call('export',selected,'Export finished.'));
$('profiles').addEventListener('change',()=>{if($('profiles').value)call('configure',$('profiles').value);});
$('search').addEventListener('input',()=>{search=$('search').value;render();});
document.addEventListener('click',e=>{const s=e.target.closest('[data-slot]'),b=e.target.closest('[data-backup]');if(s){selected=s.dataset.slot;render();}if(b){selectedBackup=b.dataset.backup;render();}});
for(const [list,key]of [['saveList','slot'],['backupList','backup']])$(list).addEventListener('keydown',e=>{if(!['ArrowDown','ArrowUp'].includes(e.key)||!state)return;e.preventDefault();const rows=Array.from($(list).querySelectorAll('[data-'+key+']'));const id=list==='saveList'?selected:selectedBackup;const index=rows.findIndex(r=>r.dataset[key]===id);const next=rows[Math.max(0,Math.min(rows.length-1,index+(e.key==='ArrowDown'?1:-1)))];if(next){if(list==='saveList')selected=next.dataset[key];else selectedBackup=next.dataset[key];render();$(list).querySelector('[aria-selected="true"]')?.focus();}});
window.addEventListener('focus',()=>{if(!$('modal').open)call('state');});setInterval(()=>{if(!busy&&!$('modal').open)call('state');},15000);call('state').then(ok=>{if(ok&&state.cloudSupported)call('resolveNames',null,null,true);});
