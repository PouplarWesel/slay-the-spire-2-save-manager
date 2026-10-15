const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('index.html'));
  if(!page)throw Error('Normal app window not found.');
  if(process.argv.includes('--verify')){
    await page.locator('#refresh').click();
    await page.locator('#saveList').getByText('Evan, Daniel',{exact:false}).waitFor();
    if(process.argv.includes('--names'))for(const name of ['PouplarWesel','danielwlionel','HastyPenguin640'])await page.locator('#saveList').getByText(name,{exact:false}).waitFor();
    const fs=require('node:fs'),path=require('node:path');
    fs.mkdirSync(path.resolve(__dirname,'../artifacts'),{recursive:true});
    await page.screenshot({path:path.resolve(__dirname,'../artifacts/normal-library-restored.png'),fullPage:true});
  }
  const result=await page.evaluate(async()=>{
    const response=await window.spire.call('state');
    return {url:location.href,response,rendered:{count:document.querySelector('#slotCount')?.textContent,rows:document.querySelector('#saveList')?.innerText,status:document.querySelector('#status')?.innerText}};
  });
  console.log(JSON.stringify({libraryPath:result.response.state?.libraryPath,profile:result.response.state?.profile,savedRuns:result.response.state?.slots?.map(s=>s.name),backupCount:result.response.state?.backups?.length,rendered:result.rendered},null,2));
  if(process.argv.includes('--close'))await page.close();
  await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
