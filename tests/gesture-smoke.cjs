const { chromium } = require('playwright');
const assert = require('assert');
const { spawn } = require('child_process');
const server = spawn(process.execPath, [require('path').join(require('path').dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host', '127.0.0.1', '--port', '4179', '--strictPort'], { stdio: 'ignore' });
async function waitForServer() {
 for (let i = 0; i < 100; i++) {
   if (server.exitCode !== null) throw new Error('Test server exited before starting');
   try { if ((await fetch('http://127.0.0.1:4179/')).ok) return; } catch {}
   await new Promise(r => setTimeout(r, 100));
 }
 throw new Error('Test server did not start');
}
process.on('exit', () => server.kill());
(async () => {
 await waitForServer();
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 await page.addInitScript(() => {
   class MockNotification {
     static permission = 'default';
     static async requestPermission() { this.permission = 'granted'; return 'granted'; }
     constructor(title, options) {
       const records = JSON.parse(localStorage.getItem('test-notifications') || '[]');
       records.push({ title, ...options }); localStorage.setItem('test-notifications', JSON.stringify(records));
     }
   }
   window.Notification = MockNotification;
 });
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://graphql.anilist.co/', async route => {
   const body=route.request().postDataJSON(); const now=Math.floor(Date.now()/1000);
   const media=i=>({id:i,title:{romaji:`Test show ${i}`},coverImage:{},format:'TV',status:'RELEASING',duration:24,genres:['Action'],description:'Description '.repeat(140),studios:{nodes:[]},externalLinks:[]});
   const schedules=Array.from({length:12},(_,j)=>({id:body.variables.page*100+j,episode:2,airingAt:body.variables.sort?.includes('TIME_DESC')?now-600-j*1000:now+1800+j*2000,mediaId:j+1,media:media(j+1)}));
   const data=body.query.includes('query Details')?{Media:media(body.variables.id)}:{Page:{pageInfo:{currentPage:body.variables.page,hasNextPage:false},airingSchedules:schedules,media:[]}};
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({data})});
 });
 await page.goto('http://127.0.0.1:4179/');
 await page.waitForTimeout(1500);
 const cdp=await context.newCDPSession(page);
 const event=async(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([x,y])=>({x,y,radiusX:2,radiusY:2,force:1}))});
 const transform=()=>page.$eval('.section-track',el=>getComputedStyle(el).transform);
 async function drag(x1,y1,x2,y2,hold=false){await event('touchStart',[[x1,y1]]); for(let i=1;i<=8;i++){await event('touchMove',[[x1+(x2-x1)*i/8,y1+(y2-y1)*i/8]]); await page.waitForTimeout(12)} if(hold)return; await event('touchEnd',[]);}
 const current=()=>page.$eval('nav.fixed[aria-label="Sections"] button[aria-current="page"]',e=>e.innerText.trim());
 console.log('initial', await current(), await transform());
 await drag(300,400,150,400,true); console.log('dragging',await transform()); assert((await transform()).includes('matrix'));
 await event('touchEnd',[]); await page.waitForTimeout(600); console.log('left',await current(),await transform()); assert((await current()).includes('Watchlist'));
 await drag(300,400,150,400); await page.waitForTimeout(600); console.log('left2',await current(),await transform()); assert((await current()).includes('Aired'));
 await drag(300,400,150,400); await page.waitForTimeout(500); assert((await current()).includes('Aired'));
 await drag(90,400,220,400); await page.waitForTimeout(600); assert((await current()).includes('Watchlist'));
 await drag(100,400,140,400); await page.waitForTimeout(500); console.log('short',await current(),await transform()); assert((await current()).includes('Watchlist'));
 await drag(300,400,180,400,true); await event('touchCancel',[]); await page.waitForTimeout(500); assert((await current()).includes('Watchlist')); console.log('cancelled swipe',await transform());
 await page.locator('nav.fixed[aria-label="Sections"] button').first().click(); await page.waitForTimeout(600);
 const panel=page.locator('[data-section="upcoming"]');
 await drag(200,650,200,250); await page.waitForTimeout(1300); console.log('scroll',await panel.evaluate(el=>el.scrollTop)); assert(await panel.evaluate(el=>el.scrollTop)>0);
 const scroll=await panel.evaluate(el=>el.scrollTop);
 await page.locator('nav.fixed[aria-label="Sections"] button').nth(1).click(); await page.waitForTimeout(400); await page.locator('nav.fixed[aria-label="Sections"] button').first().click(); await page.waitForTimeout(400);
 console.log('scroll restored',await panel.evaluate(el=>el.scrollTop)); assert(Math.abs(await panel.evaluate(el=>el.scrollTop)-scroll)<5);
 await panel.evaluate(el=>el.scrollTop=0); await page.waitForTimeout(100);
 await page.getByRole('button',{name:'Open details for Test show 1'}).first().click(); await page.waitForTimeout(500);
 const sheet=page.getByRole('dialog',{name:'Test show 1'}); console.log('sheet visible',await sheet.count());
 const scroller=sheet.locator('.overflow-y-auto'); const box=await scroller.boundingBox();
 await drag(200,box.y+110,200,box.y+200,true); console.log('sheet during',await sheet.evaluate(el=>getComputedStyle(el).transform));
 await event('touchEnd',[]); await page.waitForTimeout(600); console.log('sheet after short',await sheet.count(),await sheet.evaluate(el=>getComputedStyle(el).transform));
 await drag(200,box.y+110,200,box.y+300); await page.waitForTimeout(40); console.log('sheet during exit',await sheet.count(),await sheet.count() ? await sheet.evaluate(el=>getComputedStyle(el).transform) : 'gone'); await page.waitForTimeout(660); console.log('sheet after long',await sheet.count()); assert.equal(await sheet.count(),0);
 // Reopen after a drag-dismiss and test the handle as well as content scrolling.
 await page.getByRole('button',{name:'Open details for Test show 1'}).first().click(); await page.waitForTimeout(600);
 const sheet2=page.getByRole('dialog',{name:'Test show 1'});
 console.log('reopened position',await sheet2.evaluate(el=>getComputedStyle(el).transform));
 const handle=sheet2.locator('[aria-hidden="true"]').first(); const hb=await handle.boundingBox();
 await drag(hb.x+hb.width/2,hb.y+5,hb.x+hb.width/2,hb.y+200); await page.waitForTimeout(700);
 console.log('handle closed',await sheet2.count(),await sheet2.count() ? await sheet2.evaluate(el=>getComputedStyle(el).transform) : 'gone'); assert.equal(await sheet2.count(),0);
 // Verify filters keep their native horizontal scroll rather than changing tabs.
 const filter=page.getByRole('group',{name:'Filter schedule'}); await filter.scrollIntoViewIfNeeded();
 const fb=await filter.boundingBox(); const before=await filter.evaluate(e=>e.scrollLeft);
 await drag(fb.x+fb.width-25,fb.y+20,fb.x+30,fb.y+20); await page.waitForTimeout(600);
 const after=await filter.evaluate(e=>e.scrollLeft); console.log('filter scroll',before,after,'tab',await current()); assert(after>before); assert((await current()).includes('Upcoming'));
 // Confirmation requires an explicit destructive action; cancel retains the entry.
 await panel.evaluate(el=>el.scrollTop=0); await page.waitForTimeout(100);
 await page.getByRole('button',{name:'Add Test show 1 to watchlist'}).first().click();
 await page.getByRole('button',{name:'Open settings'}).click(); await page.waitForTimeout(400);
 // Per-show muting, permission opt-in, test notification and deduplication.
 await page.locator('#reminder-lead').selectOption('60');
 await page.getByRole('checkbox',{name:'Test show 1'}).uncheck();
 await page.getByRole('switch',{name:'Watchlist notifications'}).click();
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-notifications') || '[]').length),0);
 await page.getByRole('checkbox',{name:'Test show 1'}).check();
 await page.waitForTimeout(400);
 assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-notifications') || '[]').length),1);
 await page.getByRole('button',{name:'Send test notification'}).click(); await page.waitForTimeout(200);
 assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-notifications') || '[]').length),2);
 await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(200);
 assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('test-notifications') || '[]').length),2);
 await page.evaluate(() => { Notification.permission = 'denied'; window.dispatchEvent(new Event('focus')); });
 await page.waitForTimeout(100); assert(await page.getByText('Notifications are blocked.',{exact:false}).isVisible());
 await page.evaluate(() => { Notification.permission = 'granted'; window.dispatchEvent(new Event('focus')); });
 await page.waitForTimeout(100);
 console.log('notification opt-in, muting, delivery, denial and deduplication passed');
 await page.getByRole('button',{name:'Clear watchlist'}).click();
 console.log('confirmation' ,await page.getByText('Clear your watchlist?').count());
 await page.getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(await page.getByText('Clear your watchlist?').count(),0);
 await page.getByRole('button',{name:'Clear watchlist'}).click();
 await page.getByRole('button',{name:'Yes, clear all'}).click(); await page.waitForTimeout(500);
 await page.getByRole('button',{name:'Open settings'}).click(); await page.waitForTimeout(500);
 const settingsSheet=page.getByRole('dialog',{name:'Settings'}); const settingsBox=await settingsSheet.boundingBox();
 // A short pull from the content springs back; scrolling and the header stay usable.
 const settingsScroll=settingsSheet.locator('.overflow-y-auto').first(); const sb=await settingsScroll.boundingBox();
 await drag(180,sb.y+30,180,sb.y+85,true); await event('touchEnd',[]); await page.waitForTimeout(600);
 assert.equal(await settingsSheet.count(),1);
 await drag(180,settingsBox.y+70,180,settingsBox.y+235,true);
 console.log('settings drag', await settingsSheet.evaluate(el=>getComputedStyle(el).transform));
 await event('touchEnd',[]); await page.waitForTimeout(700); assert.equal(await settingsSheet.count(),0);
 await page.locator('nav.fixed[aria-label="Sections"] button').nth(1).click(); await page.waitForTimeout(500);
 assert(await page.getByText('Your watchlist is empty').isVisible());
 await page.locator('nav.fixed[aria-label="Sections"] button').first().click(); await page.waitForTimeout(500);
 // A back navigation and rapid taps interrupt track animations cleanly.
 await page.locator('nav.fixed[aria-label="Sections"] button').nth(1).click();
 await page.waitForTimeout(50); await page.locator('nav.fixed[aria-label="Sections"] button').nth(2).click(); await page.waitForTimeout(500);
 assert((await current()).includes('Aired')); await page.goBack(); await page.waitForTimeout(500); assert((await current()).includes('Watchlist'));
 await page.setViewportSize({width:1200,height:800}); await page.waitForTimeout(500);
 console.log('desktop track',await transform(), 'active', await page.locator('[data-section="watchlist"]').isVisible()); assert(await page.locator('[data-section="watchlist"]').isVisible()); assert(!(await page.locator('[data-section="upcoming"]').isVisible()));
 await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(500); console.log('resize track',await transform());
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('nav.fixed[aria-label="Sections"] button').nth(2).click(); await page.waitForTimeout(150);
 assert((await current()).includes('Aired')); assert((await transform()).includes('-780'));
 await page.goto('http://127.0.0.1:4179/#show/1'); await page.waitForTimeout(700);
 assert(await page.getByRole('dialog',{name:'Test show 1'}).isVisible());
 console.log('reduced motion and direct detail link passed');
 console.log('errors',errors); assert.deepEqual(errors,[]);
 await browser.close();
 server.kill();
})().catch(e=>{console.error(e);process.exit(1)});
