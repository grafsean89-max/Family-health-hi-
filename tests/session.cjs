// Real bundled Supabase SDK, mocked HTTP responses; no live credentials required.
// Start local server on port 3000, then: node tests/session.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {chromium}=require('playwright');
const jwt=expiry=>['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:'fictional-user',exp:expiry})).toString('base64url'),'fictional-signature'].join('.');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'family-session-'));
 let context,signIns=0,refreshes=0,logouts=0,rows=[],delayConfig=false,invalidRefresh=false;
 const errors=[];let expectedToken;
 const session=()=>{const exp=Math.floor(Date.now()/1000)+3600;expectedToken=jwt(exp);return {access_token:expectedToken,refresh_token:'fictional-refresh-token',token_type:'bearer',expires_in:3600,expires_at:exp,user:{id:'fictional-user',email:'demo@example.invalid'}}};
 const launch=async()=>{
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  await context.route('**/api/config',async r=>{if(delayConfig)await new Promise(resolve=>setTimeout(resolve,400));await r.fulfill({json:{supabaseUrl:'https://fictional-demo.supabase.co',supabaseKey:'sb_publishable_demo_only'}})});
  await context.route('https://fictional-demo.supabase.co/**',async r=>{
   const req=r.request(),url=new URL(req.url());
   if(url.pathname.endsWith('/token')){
    if(url.searchParams.get('grant_type')==='refresh_token'){refreshes++;assert.equal(req.postDataJSON().refresh_token,'fictional-refresh-token');if(invalidRefresh)return r.fulfill({status:400,json:{code:'refresh_token_not_found',msg:'Invalid Refresh Token'}})}else{signIns++;assert.equal(req.postDataJSON().password,'fictional-password')}
    return r.fulfill({json:session()});
   }
   if(url.pathname.endsWith('/logout')){logouts++;return r.fulfill({status:204})}
   assert.equal(req.headers().authorization,'Bearer '+expectedToken);
   if(req.method()==='POST'){rows.push({id:1,...req.postDataJSON()});return r.fulfill({status:201,body:''})}
   if(req.method()==='PATCH'){Object.assign(rows[0],req.postDataJSON());return r.fulfill({status:204})}
   return r.fulfill({json:rows});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return page;
 };
 const ready=page=>page.locator('body.auth-ready').waitFor();
 const login=async page=>{await page.getByText('Sign in with your Supabase account.',{exact:true}).waitFor();await page.getByLabel('Email',{exact:true}).fill('demo@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fictional-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await ready(page)};
 const board=async page=>{await page.locator('#nav [data-id="Appointments"]').click();await page.locator('[data-action="appointment"][data-id="a1"]').click()};
 try{
  let page=await launch();await page.goto('http://127.0.0.1:3000');await login(page);
  assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');
  const stored=await page.evaluate(()=>JSON.stringify(localStorage));assert.ok(stored.includes('refresh_token'));assert.ok(!stored.includes('fictional-password'));
  await board(page);await page.getByLabel('Question for the doctor').fill('Fictional persistence check');await page.getByRole('button',{name:'Add question',exact:true}).click();await page.getByText('Fictional persistence check',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'Include in checklist'}).check();await page.locator('.checklist .pill').waitFor();
  delayConfig=true;await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#auth-gate').isVisible(),false);assert.equal(await page.locator('#auth-loading').isVisible(),true);await ready(page);assert.equal(signIns,1);
  await board(page);await page.locator('.checklist').getByText('1. Fictional persistence check',{exact:true}).waitFor();
  await context.close();page=await launch();await page.goto('http://127.0.0.1:3000');await ready(page);assert.equal(signIns,1);
  console.log('PASS sign-in, password clearing, refresh without sign-in flash, checklist restore, full browser close/reopen');
  // Simulate an expired persisted session. The SDK must exchange its refresh token.
  await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.endsWith('-auth-token'));const value=JSON.parse(localStorage.getItem(key));value.expires_at=1;localStorage.setItem(key,JSON.stringify(value))});
  await page.reload();await ready(page);assert.ok(refreshes>=1);await board(page);await page.locator('.checklist .pill').waitFor();
  console.log('PASS expired session refresh and question request with refreshed bearer token');
  // SIGNED_OUT propagates to another tab through the SDK BroadcastChannel.
  const other=await context.newPage();await other.goto('http://127.0.0.1:3000');await ready(other);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByText('Signed out.',{exact:true}).waitFor();
  await other.locator('body:not(.auth-ready):not(.auth-checking)').waitFor();
  assert.ok(logouts>=1);assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.endsWith('-auth-token'))),false);
  await page.reload();await page.getByText('Sign in with your Supabase account.',{exact:true}).waitFor();assert.equal(await page.locator('main.wrap').isVisible(),false);
  await context.close();page=await launch();await page.goto('http://127.0.0.1:3000');await page.getByText('Sign in with your Supabase account.',{exact:true}).waitFor();assert.equal(await page.locator('main.wrap').isVisible(),false);
  console.log('PASS sign-out clears SDK session across tabs, reload and browser reopen');
  await login(page);invalidRefresh=true;
  await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.endsWith('-auth-token'));const value=JSON.parse(localStorage.getItem(key));value.expires_at=1;localStorage.setItem(key,JSON.stringify(value))});
  await page.reload();await page.getByText('Sign in with your Supabase account.',{exact:true}).waitFor();assert.equal(await page.locator('main.wrap').isVisible(),false);assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.endsWith('-auth-token'))),false);
  console.log('PASS rejected refresh clears invalid session and returns to sign-in');
  assert.deepEqual(errors,[]);
 }finally{if(context)await context.close();await fs.rm(profile,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exit(1)});
