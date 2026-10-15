const {_electron:electron}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
(async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const desktop=await electron.launch({executablePath:process.env.SPIREKEEPER_EXECUTABLE||undefined,args:process.env.SPIREKEEPER_EXECUTABLE?[]:[path.resolve(__dirname,'..')],env});
  try{
    const page=await desktop.firstWindow();
    await page.waitForFunction(()=>window.spire);
    const result=await page.evaluate(()=>window.spire.call('state'));
    if(!result.ok)throw Error(result.error);
    const state=result.state;
    if(!state.slots.some(s=>s.name==='Evan, Daniel'))throw Error('The real saved run is not in the app response.');
    await page.locator('#saveList').getByText('Evan, Daniel',{exact:false}).waitFor();
    console.log(JSON.stringify({libraryPath:state.libraryPath,profile:state.profile,savedRuns:state.slots.map(s=>s.name),backupCount:state.backups.length,displayedRows:await page.locator('[data-slot]').count()}));
    fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/restored-library.png'),fullPage:true});
  }finally{await desktop.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
