/* Patient mode is opt-in. Database RLS and RPCs enforce authority, never these controls. */
window.createFamilyAccess=function(client){
 const $=id=>document.getElementById(id);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const tables={Doctors:'fh_doctors',Medications:'fh_medications',Appointments:'fh_appointments',History:'fh_medical_history'};
 const fields={Doctors:{name:'Doctor name',specialty:'Specialty'},Medications:{name:'Medication name',dose:'Dose',frequency:'Frequency',status:'Status',doctor_id:'Prescribing doctor'},Appointments:{reason:'Reason',starts_at:'Date and time (this device’s local time)',duration_minutes:'Duration (minutes)',doctor_id:'Doctor'},History:{summary:'Fictional history summary',occurred_on:'Date',doctor_id:'Doctor'}};
 let user=null,patients=[],memberships=[],inbox=[],patientId=null,role=null,section='Overview',data={},notice='',epoch=0,timer=null,busy=false,editing=null,appointmentId=null,filterDoctor='',filterReview=false,doctorFocus='';
 const administrator=()=>role==='administrator';
 const button=(action,label,id='')=>`<button type="button" data-family-action="${action}" data-id="${escape(id)}">${escape(label)}</button>`;
 const card=(title,body)=>`<div class="panel"><h2>${escape(title)}</h2>${body}</div>`;
 const run=async query=>{const {data,error}=await query;if(error)throw error;return data||[]};
 const changed=async query=>{const rows=await run(query.select('id'));if(!rows.length)throw Error('Record unavailable or access denied.');return rows};
 const rpc=(name,args)=>run(client.rpc(name,args));
 function clearPatient(){role=null;data={};editing=null;appointmentId=null;filterDoctor='';filterReview=false;doctorFocus='';}
 function clearDisplay(text){clearPatient();$('nav').innerHTML='';$('view').innerHTML=card('Patient access',`<p role="status">${escape(text)}</p>`);}
 function recordName(record){return record.name||record.reason||record.summary||'';}
 function doctorName(id){return data.Doctors?.find(d=>d.id===id)?.name||'No doctor linked';}
 async function authorized(){
  const version=epoch,pid=patientId,uid=user?.id;
  if(!user||!patientId)throw Error('Choose an authorized patient.');
  const membership=await run(client.from('fh_memberships').select('role').eq('patient_id',pid).eq('user_id',uid));
  if(version!==epoch)throw Error('Patient selection changed.');
  if(!membership.length){clearDisplay('Patient access was revoked.');throw Error('Patient access was revoked.');}
  role=membership[0].role;
 }
 async function refresh(forceRender=false){
  if(!user||busy||document.hidden)return;
  const version=epoch,displayedRole=role;busy=true;
  try{
   const [nextPatients,nextMemberships,nextInbox]=await Promise.all([
    run(client.from('fh_patients').select('id,name').order('created_at')),
    run(client.from('fh_memberships').select('patient_id,role').eq('user_id',user.id)),
    run(client.from('fh_invitations').select('id,patient_id,role,expires_at').eq('recipient_email',(user.email||'').toLowerCase()).is('accepted_at',null).is('cancelled_at',null).gt('expires_at',new Date().toISOString()))
   ]);
   if(version!==epoch)return;
   patients=nextPatients;memberships=nextMemberships;inbox=nextInbox;
   if(patientId===null)patientId=patients[0]?.id||'';
   if(patientId&&!memberships.some(m=>m.patient_id===patientId)){patientId='';clearPatient();notice='Patient access was revoked. Choose another authorized patient.';}
   role=memberships.find(m=>m.patient_id===patientId)?.role||null;
   if(!role){clearPatient();render();return;}
   const queries=Object.entries(tables).map(async([key,table])=>[key,await run(client.from(table).select('*').eq('patient_id',patientId))]);
   queries.push((async()=>['Questions',await run(client.from('fh_appointment_questions').select('*').eq('patient_id',patientId).order('sort_order').order('created_at'))])());
   queries.push((async()=>['Members',await run(client.from('fh_memberships').select('user_id,role').eq('patient_id',patientId))])());
   if(administrator()){
    queries.push((async()=>['Invitations',await run(client.from('fh_invitations').select('id,recipient_email,role,expires_at,accepted_at,cancelled_at').eq('patient_id',patientId))])());
    queries.push((async()=>['Requests',await run(client.from('fh_admin_removal_requests').select('*').eq('patient_id',patientId).eq('status','pending'))])());
    queries.push((async()=>['Audit',await run(client.from('fh_audit_events').select('event,actor_id,subject_user_id,happened_at').eq('patient_id',patientId).order('happened_at',{ascending:false}).limit(25))])());
   }
   const records=await Promise.all(queries);
   // Recheck after loading; never display results from a stale account/patient epoch.
   const check=await run(client.from('fh_memberships').select('role').eq('patient_id',patientId).eq('user_id',user.id));
   if(version!==epoch)return;
   if(!check.length){patientId='';clearPatient();notice='Patient access was revoked.';}else{role=check[0].role;data=Object.fromEntries(records);}
   // Polls preserve an in-progress draft while access/role remains authorized.
   if(forceRender||!role||role!==displayedRole||!document.querySelector('#family-record-form:focus-within,#family-question-form:focus-within,#family-invite-form:focus-within'))render();
  }catch(error){if(version===epoch){clearDisplay('Unable to verify patient access. Patient information has been cleared.');notice='Access check failed. Retry when connected.';}}
  finally{if(version===epoch)busy=false;}
 }
 function render(){
  if(!user)return;
  const choices=['Overview',...Object.keys(tables),'Family access'];
  $('nav').innerHTML=role?choices.map(name=>button('section',name,name)).join(''):'';
  let html=`<div class="panel"><label for="family-patient">Patient (fictional demo only)</label><select id="family-patient"><option value="">Choose an authorized patient</option>${patients.map(p=>`<option value="${p.id}" ${p.id===patientId?'selected':''}>${escape(p.name)}</option>`).join('')}</select>${role?`<p class="muted">Your role: ${escape(role.replaceAll('_',' '))}</p>`:''}${notice?`<p role="status">${escape(notice)}</p>`:''}</div>`;
  html+=card('Your invitations',inbox.map(i=>`<div class="item"><p>Patient invitation · ${escape(i.role.replaceAll('_',' '))} · expires ${escape(new Date(i.expires_at).toLocaleString())}</p>${button('accept','Accept invitation',i.id)}</div>`).join('')||'<p class="muted">No pending invitations for your verified account.</p>');
  if(!role)html+=card('Get started',`<p>Create an empty fictional demo patient. You become its first administrator. Do not enter real medical information.</p>${button('create','Create fictional demo patient')}`);
  else if(section==='Overview')html+=card('Patient overview',`<p>${data.Doctors?.length||0} doctors · ${data.Medications?.length||0} medications · ${data.Appointments?.length||0} appointments</p><div class="toolbar">${button('section','Current medications','Medications')}${button('section','Appointments & questions','Appointments')}${button('section','Family access','Family access')}</div>${(data.Medications||[]).map(m=>`<div class="item">${escape(m.name)} · ${escape(m.dose)} · ${escape(m.status)} ${button('section','View prescribing doctor','Doctors')}</div>`).join('')}`);
  else if(section==='Family access')html+=familyPanel();
  else if(section==='Appointments'&&appointmentId)html+=appointmentPanel();
  else if(tables[section])html+=recordPanel();
  $('view').innerHTML=html;
  $('family-patient').addEventListener('change',e=>{epoch++;busy=false;patientId=e.target.value;clearDisplay('Checking patient access…');section='Overview';refresh()});
  document.querySelectorAll('[data-family-action]').forEach(el=>el.addEventListener('click',()=>action(el.dataset.familyAction,el.dataset.id)));
  $('family-record-form')?.addEventListener('submit',saveRecord);
  $('family-invite-form')?.addEventListener('submit',invite);
  $('family-question-form')?.addEventListener('submit',addQuestion);
  document.querySelectorAll('[data-family-question]').forEach(el=>el.addEventListener('change',()=>mutate(async()=>{await authorized();await changed(client.from('fh_appointment_questions').update({selected_for_checklist:el.checked}).eq('id',el.dataset.familyQuestion).eq('patient_id',patientId))})));
  $('family-doctor-filter')?.addEventListener('change',e=>{filterDoctor=e.target.value;render()});
  $('family-review-filter')?.addEventListener('change',e=>{filterReview=e.target.checked;render()});
 }
 function input(field,label,record){
  const value=record?.[field]??(field==='status'?'Needs review':field==='duration_minutes'?30:'');
  let control;
  if(field==='doctor_id')control=`<select id="family-${field}" name="${field}"><option value="">No doctor linked</option>${(data.Doctors||[]).map(d=>`<option value="${d.id}" ${value===d.id?'selected':''}>${escape(d.name)}</option>`).join('')}</select>`;
  else if(field==='status')control=`<select id="family-${field}" name="${field}">${['Confirmed','Needs review'].map(s=>`<option ${value===s?'selected':''}>${s}</option>`).join('')}</select>`;
  else if(field==='summary')control=`<textarea id="family-${field}" name="${field}" maxlength="2000" required>${escape(value)}</textarea>`;
  else{
   let type='text',formatted=value;
   if(field==='starts_at'){type='datetime-local';if(value){const d=new Date(value);formatted=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}}
   if(field==='occurred_on')type='date';if(field==='duration_minutes')type='number';
   control=`<input id="family-${field}" name="${field}" type="${type}" value="${escape(formatted)}" ${['name','reason','starts_at','occurred_on','duration_minutes'].includes(field)?'required':''} ${field==='duration_minutes'?'min="1" max="1440"':`maxlength="${field==='reason'?500:100}"`}>`;
  }
  return `<label for="family-${field}">${escape(label)}</label>${control}`;
 }
 function recordPanel(){
  let records=data[section]||[];
  let controls='';
  if(section==='Doctors'&&doctorFocus){records=records.filter(d=>d.id===doctorFocus);controls=button('all-doctors','All doctors');}
  if(section==='Medications'){
   controls=`<label for="family-doctor-filter">Prescribing doctor</label><select id="family-doctor-filter"><option value="">All doctors</option>${(data.Doctors||[]).map(d=>`<option value="${d.id}" ${filterDoctor===d.id?'selected':''}>${escape(d.name)}</option>`).join('')}</select><label class="filter-check"><input type="checkbox" id="family-review-filter" ${filterReview?'checked':''}> Needs review only</label>`;
   records=records.filter(m=>(!filterDoctor||m.doctor_id===filterDoctor)&&(!filterReview||m.status==='Needs review'));
  }
  return card(section,controls+records.map(r=>`<div class="item"><b>${escape(recordName(r))}</b><p class="muted">${escape(section==='Appointments'?new Date(r.starts_at).toLocaleString():section==='Medications'?r.dose+' · '+r.frequency+' · '+r.status:section==='History'?r.occurred_on:r.specialty)}</p>${r.doctor_id?`<p>Doctor: ${escape(doctorName(r.doctor_id))}</p>${button('doctor','View doctor',r.doctor_id)}`:''}${section==='Doctors'?`<p>Prescriptions: ${(data.Medications||[]).filter(m=>m.doctor_id===r.id).map(m=>escape(m.name)).join(', ')||'None'}</p>${button('prescriptions','View prescribed medications',r.id)}`:''}<div class="toolbar">${section==='Appointments'?button('appointment','Questions & checklist',r.id):''}${administrator()?button('edit','Edit',r.id)+button('delete','Delete',r.id):''}</div></div>`).join('')+(records.length?'':'<p>No records match.</p>')+(administrator()?`<h3>${editing?'Edit':'Add'} fictional record</h3><form id="family-record-form">${Object.entries(fields[section]).map(([f,l])=>input(f,l,records.find(r=>r.id===editing))).join('')}<button class="primary" type="submit">Save fictional record</button>${button('cancel-edit','Cancel edit')}</form>`:''));
 }
 function familyPanel(){
  let body=(data.Members||[]).map(m=>`<div class="item"><b>${escape(m.user_id===user.id?'You':m.user_id)}</b> · ${escape(m.role.replaceAll('_',' '))}${administrator()&&m.user_id!==user.id?`<div class="toolbar">${m.role==='family_member'?button('promote','Make administrator',m.user_id)+button('revoke','Revoke access',m.user_id):button('request-demote','Request demotion',m.user_id)+button('request-revoke','Request removal',m.user_id)}</div>`:''}</div>`).join('');
  if(administrator()){
   body+=`<h3>Invite a family member</h3><p>Invitations appear in the intended user’s app inbox after sign-in with a verified email. No email is sent automatically. Expires in seven days.</p><form id="family-invite-form"><label for="family-email">Recipient email</label><input type="email" id="family-email" name="email" required maxlength="254"><label for="family-role">Patient role</label><select id="family-role" name="role"><option value="family_member">Family member</option><option value="administrator">Administrator</option></select><button type="submit">Create invitation</button></form>`;
   body+=`<h3>Pending invitations</h3>${(data.Invitations||[]).filter(i=>!i.accepted_at&&!i.cancelled_at).map(i=>`<div class="item">${escape(i.recipient_email)} · ${escape(i.role)} · ${escape(new Date(i.expires_at).toLocaleString())}${button('cancel-invite','Cancel invitation',i.id)}</div>`).join('')||'<p>None</p>'}`;
   body+=`<h3>Administrator removal requests</h3><p>Access remains unchanged until the target administrator approves using their own account. At least one administrator must remain.</p>${(data.Requests||[]).map(r=>`<div class="item">${escape(r.action)} administrator ${escape(r.target_user_id)} · expires ${escape(new Date(r.expires_at).toLocaleString())}${r.target_user_id===user.id?button('approve','Approve my '+(r.action==='revoke'?'removal':'demotion'),r.id):''}${button('cancel-request','Cancel request',r.id)}</div>`).join('')||'<p>None</p>'}`;
   body+=`<h3>Recent audit events</h3>${(data.Audit||[]).map(a=>`<div class="item">${escape(a.event)} · ${escape(new Date(a.happened_at).toLocaleString())}<div class="muted">Actor: ${escape(a.actor_id)}</div></div>`).join('')}`;
  }
  return card('Family access',body);
 }
 function appointmentPanel(){
  const appointment=data.Appointments?.find(a=>a.id===appointmentId);
  if(!appointment)return card('Appointment unavailable',button('section','All appointments','Appointments'));
  const upcoming=new Date(appointment.starts_at)>new Date();
  const questions=(data.Questions||[]).filter(q=>q.appointment_id===appointment.id);
  return card('Appointment questions',`<div class="toolbar">${button('all-appointments','All appointments')}</div><h3>${escape(appointment.reason)}</h3><p>${escape(new Date(appointment.starts_at).toLocaleString())} · ${escape(doctorName(appointment.doctor_id))}</p>${button('calendar','Add to Calendar (.ics)',appointment.id)}<p class="muted">Calendar export uses the stored instant and duration (${appointment.duration_minutes} minutes).</p>${upcoming?`<form id="family-question-form"><label for="family-question">Fictional question for the doctor</label><textarea id="family-question" name="question" required maxlength="500"></textarea><button type="submit">Add question</button></form>`:'<p>Question additions and checklist selections close when the appointment starts.</p>'}${questions.map(q=>`<div class="question"><input type="checkbox" data-family-question="${q.id}" ${q.selected_for_checklist?'checked':''} ${upcoming?'':'disabled'} aria-label="Include ${escape(q.question)} in checklist"><div class="questiontext"><b>${escape(q.question)}</b><div class="muted">Author: ${escape(q.author_id===user.id?'You':q.author_id)}</div></div>${administrator()?button('remove-question','Remove',q.id)+button('order-question','Set order',q.id):''}</div>`).join('')}<div class="checklist"><h3>Visit checklist</h3>${questions.filter(q=>q.selected_for_checklist).map(q=>`<div class="pill">${escape(q.question)}</div>`).join('')||'<p>No questions selected.</p>'}${button('copy-checklist','Copy checklist')}</div>`);
 }
 async function mutate(operation){
  const version=epoch;
  try{await operation();if(version!==epoch)return;notice='Saved.';editing=null;}
  catch(error){if(version!==epoch)return;notice='Could not save: '+error.message;}
  epoch++;busy=false;await refresh(true);
 }
 async function saveRecord(event){
  event.preventDefault();const form=new FormData(event.target),record={};
  for(const field of Object.keys(fields[section]))record[field]=form.get(field)||'';
  if('doctor_id' in record)record.doctor_id=record.doctor_id||null;
  if('starts_at' in record)record.starts_at=new Date(record.starts_at).toISOString();
  if('duration_minutes' in record)record.duration_minutes=Number(record.duration_minutes);
  const table=tables[section],id=editing;
  await mutate(async()=>{await authorized();if(!administrator())throw Error('Administrator access required.');if(id)await changed(client.from(table).update(record).eq('id',id).eq('patient_id',patientId));else await run(client.from(table).insert({...record,patient_id:patientId}));});
 }
 async function invite(event){event.preventDefault();const form=new FormData(event.target);await mutate(async()=>{await authorized();await rpc('fh_invite',{p_patient:patientId,p_email:form.get('email'),p_role:form.get('role')})});}
 async function addQuestion(event){event.preventDefault();const text=new FormData(event.target).get('question').trim(),aid=appointmentId;await mutate(async()=>{await authorized();await run(client.from('fh_appointment_questions').insert({patient_id:patientId,appointment_id:aid,question:text}))});}
 async function action(name,id){
  const actionTable=tables[section];
  if(name==='section'){section=id;editing=null;appointmentId=null;doctorFocus='';render();return;}
  if(name==='edit'){editing=id;render();$('family-record-form')?.scrollIntoView({block:'start'});return;}
  if(name==='cancel-edit'){editing=null;render();return;}
  if(name==='appointment'){appointmentId=id;render();return;}
  if(name==='all-appointments'){appointmentId=null;render();return;}
  if(name==='prescriptions'){section='Medications';filterDoctor=id;filterReview=false;render();return;}
  if(name==='doctor'){section='Doctors';doctorFocus=id;editing=null;render();return;}
  if(name==='all-doctors'){doctorFocus='';render();return;}
  if(name==='copy-checklist'){const text=(data.Questions||[]).filter(q=>q.appointment_id===appointmentId&&q.selected_for_checklist).map(q=>q.question).join('\n');try{await navigator.clipboard.writeText(text);notice='Checklist copied.'}catch{notice='Clipboard unavailable. Select and copy the checklist text.'}render();return;}
  if(name==='calendar'){const a=data.Appointments.find(a=>a.id===id);if(a)downloadCalendar(a);return;}
  if(['delete','revoke','promote','request-demote','request-revoke','approve','remove-question'].includes(name)&&!confirm('Confirm this change for the fictional demo patient?'))return;
  await mutate(async()=>{
   if(name==='create'){patientId=await rpc('fh_create_demo_patient',{});section='Overview';return;}
   if(name==='accept'){patientId=await rpc('fh_accept_invitation',{p_invitation:id});section='Overview';return;}
   await authorized();
   if(name==='delete')await changed(client.from(actionTable).delete().eq('id',id).eq('patient_id',patientId));
   if(name==='revoke')await rpc('fh_revoke_member',{p_patient:patientId,p_user:id});
   if(name==='promote')await rpc('fh_promote_member',{p_patient:patientId,p_user:id});
   if(name==='request-demote'||name==='request-revoke')await rpc('fh_request_admin_removal',{p_patient:patientId,p_user:id,p_action:name==='request-demote'?'demote':'revoke'});
   if(name==='approve')await rpc('fh_approve_admin_removal',{p_request:id});
   if(name==='cancel-request')await rpc('fh_cancel_admin_removal',{p_request:id});
   if(name==='cancel-invite')await rpc('fh_cancel_invitation',{p_invitation:id});
   if(name==='remove-question')await changed(client.from('fh_appointment_questions').delete().eq('id',id).eq('patient_id',patientId));
   if(name==='order-question'){const order=prompt('Question order (0–10000)');if(order!==null)await rpc('fh_order_question',{p_question:id,p_order:Number(order)})}
  });
 }
 function downloadCalendar(a){
  const timestamp=d=>new Date(d).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const text=t=>String(t).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Family Health Hub//Fictional Demo//EN','BEGIN:VEVENT','UID:'+a.id+'@family-health-hub.invalid','DTSTAMP:'+timestamp(new Date()),'DTSTART:'+timestamp(a.starts_at),'DURATION:PT'+a.duration_minutes+'M','SUMMARY:'+text(a.reason+' — '+doctorName(a.doctor_id)),'DESCRIPTION:Fictional demo appointment only.','END:VEVENT','END:VCALENDAR'];
  const calendar=lines.map(line=>{let folded='',part='',bytes=0;for(const c of line){const size=new TextEncoder().encode(c).length;if(bytes+size>75){folded+=part+'\r\n';part=' ';bytes=1}part+=c;bytes+=size}return folded+part}).join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([calendar],{type:'text/calendar;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download='fictional-appointment-'+a.id+'.ics';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden){epoch++;busy=false;clearDisplay('Patient information hidden while the app is in the background.');}else{refresh()}});
 window.addEventListener('focus',()=>refresh());
 window.addEventListener('offline',()=>{epoch++;busy=false;clearDisplay('Offline. Patient information cleared until access can be verified.');});
 window.addEventListener('online',()=>refresh());
 return {setSession(nextUser){
  if(nextUser?.id&&nextUser.id===user?.id)return;
  epoch++;busy=false;clearInterval(timer);user=nextUser;patients=[];memberships=[];inbox=[];patientId=null;clearPatient();notice='';
  clearDisplay(user?'Checking patient access…':'Signed out.');
  if(user){refresh();timer=setInterval(()=>refresh(),3000)}
 }};
};
