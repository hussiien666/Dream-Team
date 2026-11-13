import { useState } from 'react';
import type { Client } from './api';
import type { View, Definition } from './invitations';
import { Dialog, Field, Notice, useAction } from './ui';
import { TurnstileChallenge } from './turnstile';
function Fields({defs,prefix,values={}}:{defs:Definition[];prefix:string;values?:Record<string,unknown>}) {
  return <>{defs.map(f=><Field key={f.key} label={f.label}>{f.type==='dropdown'?<select aria-label={f.label} name={prefix+f.key} required={f.required} defaultValue={String(values[f.key]??'')}>
    <option value="">Select value</option>{f.options.map(o=><option key={o}>{o}</option>)}</select>:<input name={prefix+f.key} type={f.type==='phone'?'tel':f.type}
      required={f.required&&f.type!=='checkbox'} step={f.type==='number'?'any':undefined} maxLength={3000}
      defaultChecked={f.type==='checkbox'?values[f.key]===true:undefined} defaultValue={f.type==='checkbox'?undefined:String(values[f.key]??'')}/>}</Field>)}</>;
}
function values(fd:FormData,defs:Definition[],prefix:string){return Object.fromEntries(defs.map(f=>{const v=fd.get(prefix+f.key);return[f.key,f.type==='checkbox'?v==='on':v===''?null:f.type==='number'?Number(v):v];}));}
export function PublicRegistrationForm({view,guest,api,close,saved}:{view:View;guest?:View['guests'][number];api:Client;close:()=>void;saved:()=>void}) {
  const a=useAction(),[quantity,setQuantity]=useState(guest?1:Math.min(1,Math.max(0,view.guestLimit-view.guests.filter(g=>g.active).length))),
    [challenge,setChallenge]=useState(''),[challengeVersion,setChallengeVersion]=useState(0);
  const [operation,setOperation]=useState<{key:string;body:string}>();
  const studentFields=view.fields.filter(f=>f.target==='student'),guestFields=view.fields.filter(f=>f.target==='guest');
  const max=guest?1:Math.min(view.maxGuestsPerSubmission,Math.max(0,view.guestLimit-view.guests.filter(g=>g.active).length));
  return <Dialog title={guest?'Amend guest registration':'Student and guest registration'} close={()=>!a.busy&&close()}><Notice error={a.error}/>
    <p>This private form belongs only to {view.student.fullName}. Your Student ID cannot be used to open someone else's form.</p>
    <p>Quantity counts guest tickets only. Your own student ticket is separate. Availability is checked again when you submit.</p>
    <form onSubmit={e=>{e.preventDefault();const fd=new FormData(e.currentTarget);const body={action:'register',confirmed:true,quantity,
      student:{fullName:fd.get('studentName'),email:fd.get('studentEmail'),phone:fd.get('studentPhone'),customValues:values(fd,studentFields,'student_')},
      guests:Array.from({length:quantity},(_,i)=>({...(guest?{id:guest.id}:{}),fullName:fd.get(`guest_${i}_name`),email:fd.get(`guest_${i}_email`),phone:fd.get(`guest_${i}_phone`),
        categoryId:Number(fd.get(`guest_${i}_category`)),customValues:values(fd,guestFields,`guest_${i}_custom_`)}))};
      const serialized=JSON.stringify(body),key=operation?.body===serialized?operation.key:crypto.randomUUID();setOperation({body:serialized,key});
      void a.run(async()=>{try{await api.request('public/invitations','POST',{...body,requestKey:key},undefined,false,challenge?{'X-Turnstile-Token':challenge}:undefined);saved();}
        finally{setChallenge('');setChallengeVersion(v=>v+1);}});
    }}>
      <fieldset><legend>Your details</legend><Field label="Student ID"><input value={view.student.studentId} readOnly/></Field>
        <Field label="Your full name"><input name="studentName" defaultValue={view.student.fullName} required maxLength={200}/></Field>
        <Field label="Your email"><input name="studentEmail" type="email" defaultValue={view.student.email} required maxLength={254}/></Field>
        <Field label="Your phone"><input name="studentPhone" type="tel" defaultValue={view.student.phone} maxLength={40}/></Field>
        <Fields defs={studentFields} prefix="student_" values={view.student.customValues}/></fieldset>
      <Field label={guest?'Guest tickets being amended':'Guest ticket quantity to add'}><select aria-label={guest?'Guest tickets being amended':'Guest ticket quantity to add'} value={quantity} disabled={!!guest} onChange={e=>setQuantity(Number(e.target.value))}>
        {Array.from({length:max+1},(_,i)=>i).filter(i=>!guest||i===1).map(i=><option key={i} value={i}>{i}</option>)}</select></Field>
      {!guest&&<p>Choose 0 to update only your details. Up to {max} new guests in this submission; existing guests stay registered.</p>}
      {Array.from({length:quantity},(_,i)=><fieldset key={i}><legend>Guest {i+1}</legend>
        <Field label={`Guest ${i+1} name`}><input name={`guest_${i}_name`} defaultValue={guest?.attendee.fullName} required maxLength={200}/></Field>
        <Field label={`Guest ${i+1} email`}><input name={`guest_${i}_email`} type="email" defaultValue={guest?.email??''} maxLength={254}/></Field>
        <Field label={`Guest ${i+1} phone`}><input name={`guest_${i}_phone`} type="tel" defaultValue={guest?.attendee.phone} maxLength={40}/></Field>
        <Field label={`Guest ${i+1} category`}><select aria-label={`Guest ${i+1} category`} name={`guest_${i}_category`} required defaultValue={guest?.attendee.categoryId??view.defaultCategoryId??''}>
          <option value="">Choose category</option>{view.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Fields defs={guestFields} prefix={`guest_${i}_custom_`} values={guest?.customValues}/></fieldset>)}
      <label className="check"><input type="checkbox" required/>I reviewed my details and every guest</label>
      <TurnstileChallenge key={challengeVersion} siteKey={view.turnstile?.siteKey} onToken={setChallenge}/>
      <button className="primary" type="submit" disabled={a.busy||!!view.turnstile&&!challenge}>{a.busy?'Saving registration…':'Confirm registration'}</button>
    </form></Dialog>;
}
