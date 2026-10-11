// Patient-mode UX regression tests. RLS authorization is tested separately in PostgreSQL.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
 for(const width of [390,820]){
  const context=await browser.newContext({viewport:{width,height:1000}});
  let role='administrator',revoked=false,questions=[],legacyCalls=0;const errors=[];const patient='10000000-0000-0000-0000-000000000001';
  const doctors=[{id:'doctor',patient_id:patient,name:'Fictional doctor',specialty:'Demo care'}];
  const appointments=[{id:'appointment',patient_id:patient,reason:'Fictional follow-up',starts_at:'2099-10-21T14:30:00Z',duration_minutes:30,doctor_id:'doctor'}];
  await context.route('**/api/config',r=>r.fulfill({json:{supabaseUrl:'https://fictional-demo.supabase.co',supabaseKey:'sb_publishable_demo_only',familyAccessEnabled:true}}));
  await context.route('https://fictional-demo.supabase.co/**',async r=>{
   const req=r.request(),url=new URL(req.url()),table=url.pathname.split('/').pop();
   if(url.pathname.includes('/auth/v1/token'))return r.fulfill({json:{access_token:'fictional-token',refresh_token:'fictional-refresh',token_type:'bearer',expires_in:3600,user:{id:'user',email:'demo@example.invalid'}}});
   if(url.pathname.includes('/auth/v1/logout'))return r.fulfill({status:204});
   assert.equal(req.headers().authorization,'Bearer fictional-token');
   if(table==='appointment_questions'){legacyCalls++;return r.fulfill({status:403,json:{message:'Legacy disabled'}})}
   if(url.pathname.includes('/rpc/'))return r.fulfill({json:null});
   let rows=[];
   if(!revoked){
    if(table==='fh_patients')rows=[{id:patient,name:'Fictional patient'}];
    if(table==='fh_memberships')rows=[{patient_id:patient,user_id:'user',role}];
    if(table==='fh_doctors')rows=doctors;
    if(table==='fh_medications')rows=[{id:'med',name:'Fictional medication',dose:'Demo dose',frequency:'Demo frequency',status:'Needs review',doctor_id:'doctor'}];
    if(table==='fh_appointments')rows=appointments;
    if(table==='fh_appointment_questions'){
     if(req.method()==='POST'){questions.push({id:'question',author_id:'user',created_at:new Date().toISOString(),...req.postDataJSON()});return r.fulfill({status:201,body:''})}
     if(req.method()==='PATCH'){Object.assign(questions[0],req.postDataJSON());return r.fulfill({json:[{id:'question'}]})}
     rows=questions;
    }
   }
   return r.fulfill({json:rows});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.env.TEST_BASE_URL||'http://127.0.0.1:3000'));await page.getByText('Sign in with your Supabase account.',{exact:true}).waitFor();
  await page.getByLabel('Email',{exact:true}).fill('demo@example.invalid');await page.getByLabel('Password',{exact:true}).fill('fictional-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:'Patient overview',exact:true}).waitFor();
  await page.locator('#nav').getByRole('button',{name:'Doctors',exact:true}).click();await page.getByRole('button',{name:'Save fictional record'}).waitFor();
  // Demotion during an active form must remove admin controls.
  await page.getByLabel('Doctor name',{exact:true}).fill('Unsaved fictional draft');role='family_member';
  await page.getByRole('button',{name:'Save fictional record'}).waitFor({state:'hidden'});
  await page.locator('#nav').getByRole('button',{name:'Appointments',exact:true}).click();await page.getByRole('button',{name:'Questions & checklist'}).click();
  await page.getByLabel('Fictional question for the doctor').fill('Fictional shared question');await page.getByRole('button',{name:'Add question',exact:true}).click();
  await page.getByText('Fictional shared question',{exact:true}).waitFor();await page.getByRole('checkbox',{name:'Include Fictional shared question in checklist'}).check();
  await page.locator('.checklist').getByText('Fictional shared question',{exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'Patient overview',exact:true}).waitFor();
  await page.locator('#nav').getByRole('button',{name:'Appointments',exact:true}).click();await page.getByRole('button',{name:'Questions & checklist'}).click();await page.locator('.checklist').getByText('Fictional shared question',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByLabel('Fictional question for the doctor').fill('Unsaved draft during revocation');revoked=true;
  await page.getByText('Patient access was revoked.',{exact:false}).waitFor();
  assert.equal(await page.getByText('Fictional shared question',{exact:true}).count(),0);
  assert.equal(await page.getByText('Fictional follow-up',{exact:true}).count(),0);
  assert.equal(legacyCalls,0);assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#auth-message').filter({hasText:'Signed out.'}).waitFor();assert.equal(await page.locator('main.wrap').isVisible(),false);
  await context.close();console.log(`PASS ${width}px: patient mode, demotion during draft, family questions/checklist/refresh, revocation while editing clears data, no legacy queries, sign-out`);
 }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
