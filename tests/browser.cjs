// Run with the local server on port 3000 and Playwright/Chromium installed:
// node tests/browser.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try {
 for(const viewport of [{width:390,height:844},{width:820,height:1180}]){
  const context=await browser.newContext({viewport,acceptDownloads:true});
  let rows=[],nextId=1;const errors=[];
  await context.route('**/api/config',r=>r.fulfill({json:{supabaseUrl:'https://fictional-demo.supabase.co',supabaseKey:'sb_publishable_demo_only'}}));
  await context.route('https://fictional-demo.supabase.co/**',async r=>{
   const req=r.request(),url=new URL(req.url());
   if(url.pathname.includes('/auth/v1/token'))return r.fulfill({json:{access_token:'fictional-test-token',refresh_token:'fictional-refresh',token_type:'bearer',expires_in:3600,user:{id:'fictional-user',email:'demo@example.invalid'}}});
   if(url.pathname.includes('/auth/v1/logout'))return r.fulfill({status:204});
   assert.equal(req.headers().authorization,'Bearer fictional-test-token');
   if(req.method()==='POST'){rows.push({id:nextId++,...req.postDataJSON()});return r.fulfill({status:201,body:''})}
   if(req.method()==='PATCH'){Object.assign(rows.find(row=>row.id===Number(url.searchParams.get('id').slice(3))),req.postDataJSON());return r.fulfill({status:204})}
   return r.fulfill({json:rows});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const visible=async selector=>{await page.locator(selector).waitFor({state:'visible'})};
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const login=async()=>{
   await page.getByText('Sign in with your Supabase account.',{exact:true}).waitFor();
   await page.getByLabel('Email',{exact:true}).fill('demo@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fictional-only');
   await page.getByRole('button',{name:'Sign in',exact:true}).click();await visible('main.wrap');
  };
  await page.goto('http://127.0.0.1:3000');assert.equal(await page.locator('main.wrap').isVisible(),false);await login();
  await visible('[data-action="medication"][data-id="metformin"]');await noOverflow();
  await page.getByRole('button',{name:'Review medications',exact:true}).click();
  assert.equal(await page.locator('#medicationReview').isChecked(),true);
  assert.equal(await page.locator('[data-action="medication"]').count(),1);
  await page.getByLabel('Prescribing doctor',{exact:true}).selectOption('patel');
  await page.getByText('No medications match these filters.',{exact:true}).waitFor();
  await page.getByLabel('Needs review only').uncheck();assert.equal(await page.locator('[data-action="medication"]').count(),2);
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();assert.equal(await page.locator('[data-action="medication"]').count(),3);
  await page.locator('[data-action="medication"][data-id="metformin"]').click();
  await page.locator('[data-action="doctor"][data-id="chen"]').click();
  await page.getByRole('heading',{name:'Medications prescribed',exact:true}).waitFor();
  assert.equal(await page.locator('[data-action="medication"]').count(),1);
  await page.locator('[data-action="medication"][data-id="metformin"]').click();await page.getByRole('heading',{name:'Metformin',exact:true}).waitFor();await noOverflow();
  await page.locator('#nav [data-id="Doctors"]').click();await page.locator('[data-action="doctor"][data-id="morgan"]').click();await page.getByText('No medications linked',{exact:true}).waitFor();
  await page.locator('#nav [data-id="Appointments"]').click();await page.locator('[data-action="appointment"][data-id="a1"]').click();
  await page.getByLabel('Question for the doctor').fill('Fictional demo question');await page.getByRole('button',{name:'Add question',exact:true}).click();
  await page.getByText('Fictional demo question',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'Include in checklist'}).check();
  await page.locator('.checklist').getByText('1. Fictional demo question',{exact:true}).waitFor();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Add to Calendar (.ics)',exact:true}).click();
  const download=await downloadPromise;const raw=await fs.readFile(await download.path(),'utf8');const unfolded=raw.replace(/\r\n /g,'');
  assert.match(download.suggestedFilename(),/\.ics$/);assert.match(unfolded,/DTSTART:20261021T103000\r\n/);assert.match(unfolded,/DURATION:PT30M/);assert.match(unfolded,/Dr\. Taylor Morgan/);assert.match(unfolded,/Medication and memory review/);assert.match(unfolded,/Assumptions:/);assert.doesNotMatch(unfolded,/TZID|DTSTART:.*Z/);
  for(const line of raw.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
  assert.match(raw,/BEGIN:VCALENDAR\r\n/);assert.match(raw,/END:VCALENDAR\r\n$/);
  // Check afternoon conversion, midnight, escaping and Unicode folding.
  const custom=await page.evaluate(()=>appointmentCalendar({id:'test',date:'2026-12-31',time:'12:00 AM',doctor:'chen',reason:'Demo, semicolon; newline\n'+ 'é'.repeat(100)}));
  assert.match(custom,/DTSTART:20261231T000000/);assert.match(custom.replace(/\r\n /g,''),/Demo\\, semicolon\\; newline\\n/);for(const line of custom.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
  assert.match(await page.evaluate(()=>appointmentCalendar(appts[1])),/DTSTART:20261105T140000/);
  await noOverflow();await page.reload();await visible('main.wrap');await page.locator('#nav [data-id="Appointments"]').click();await page.locator('[data-action="appointment"][data-id="a1"]').click();
  await page.locator('.checklist').getByText('1. Fictional demo question',{exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'Include in checklist'}).isChecked(),true);
  await page.getByRole('button',{name:'Remove question',exact:true}).click();await page.getByText('No questions yet.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByText('Signed out.',{exact:true}).waitFor();assert.equal(await page.locator('main.wrap').isVisible(),false);
  assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${viewport.width}px: medication navigation/combined filters, calendar download, mocked auth/question/checklist persistence and logout, no horizontal overflow`);
 }
 const context=await browser.newContext();await context.route('**/api/config',r=>r.fulfill({json:{supabaseUrl:'',supabaseKey:''}}));const page=await context.newPage();await page.goto('http://127.0.0.1:3000');await page.getByRole('status').filter({hasText:'Setup needed:'}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isDisabled(),true);await context.close();console.log('PASS missing-config authentication gate');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
