import { useState, useEffect } from "react";
import type { Client } from "./api";
import type { EventRecord, Category } from "./types";
import { Confirm, Dialog, Field, Notice, Loading, useAction, useResource, usePage,useDebounced,PageControls,RefreshState } from "./ui";
type Attendee={id:number;fullName:string;email:string|null;phone:string;identityNumber:string|null;organization:string;notes:string;categoryId:number;status:string;category:{name:string};tickets:{number:string}[]};
type Preview={count:number;errorCount:number;errors:{row:number;message:string}[];previewHash:string;rows:{fullName:string;email:string|null;identityNumber:string|null}[]};
export function Attendees({api,event}:{api:Client;event:EventRecord}) {
  const base=`events/${event.id}/attendees`,a=useAction();
  const categories=useResource<Category[]>(api,`events/${event.id}/categories`);
  const [search,setSearch]=useState(''),[status,setStatus]=useState('all'),[edit,setEdit]=useState<{row?:Attendee}>(),[cancel,setCancel]=useState<Attendee>(),[importing,setImporting]=useState(false);
  const term=useDebounced(search),path=base+`/independent/page?status=${status}&search=${encodeURIComponent(term)}`,page=usePage(path);
  const resource=useResource<{rows:Attendee[];nextAfter:number|null}>(api,path+(page.after?'&after='+page.after:'')),data={...resource,data:resource.data?.rows};
  useEffect(()=>{if(resource.data?.nextAfter)api.prefetch(path+'&after='+resource.data.nextAfter);},[api,path,resource.data?.nextAfter]);
  const [message,setMessage]=useState('');const readonly=event.archived||['Completed','Cancelled'].includes(event.status);
  const download=(path:string,name:string)=>void a.run(async()=>{const blob=await api.request<Blob>(path,'GET',undefined,undefined,true);const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  const rows=data.data?.filter(r=>(status==='all'||r.status===status)&&[r.fullName,r.email,r.phone,r.identityNumber,...r.tickets.map(t=>t.number)].some(v=>v?.toLowerCase().includes(search.toLowerCase())))??[];
  return <><h1>Independent attendees</h1><p>{event.name}. Linked student guests remain in Students &amp; Invitations.</p><Notice error={a.error||data.error}/>{data.loading&&<Loading/>}<RefreshState refreshing={data.refreshing} error={data.error} hasData={!!data.data}/>{message&&<p role="status">{message}</p>}
    <div className="actions"><button disabled={readonly} onClick={()=>setEdit({})}>Add attendee</button><button disabled={readonly} onClick={()=>setImporting(true)}>Import attendees</button><button onClick={()=>download(base+'/template','attendees-template.xlsx')}>Download attendee template</button>
      <button onClick={()=>download(base+`/export/csv?status=${status}&search=${encodeURIComponent(search)}`,'attendees.csv')}>Export attendee CSV</button><button onClick={()=>download(base+`/export/xlsx?status=${status}&search=${encodeURIComponent(search)}`,'attendees.xlsx')}>Export attendee Excel</button></div>
    <div className="filters"><Field label="Search attendees"><input value={search} onChange={e=>setSearch(e.target.value)} maxLength={200}/></Field><Field label="Attendee status"><select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All</option><option value="Registered">Registered</option><option value="Cancelled">Cancelled</option></select></Field></div>
    <p>{rows.length} attendees on this page</p><PageControls page={page} next={resource.data?.nextAfter} busy={data.loading}/><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email / ID</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.fullName}</td><td>{r.email||r.identityNumber}</td><td>{r.category.name}</td><td>{r.status}</td><td><button disabled={readonly} onClick={()=>setEdit({row:r})}>Edit attendee</button><button disabled={readonly||r.status==='Cancelled'} onClick={()=>setCancel(r)}>Cancel attendee</button></td></tr>)}</tbody></table></div>
    {edit&&<Dialog title={edit.row?'Edit attendee':'Add attendee'} close={()=>setEdit(undefined)}><Notice error={a.error}/><form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);void a.run(async()=>{
      const body=Object.fromEntries(d.entries());await api.request(base+(edit.row?'/'+edit.row.id:''),edit.row?'PATCH':'POST',{...body,categoryId:Number(body.categoryId),email:body.email||null,identityNumber:body.identityNumber||null});
      setEdit(undefined);setMessage('Attendee saved. Existing ticket files remain snapshots.');data.reload();
    });}} className="settings-form">
      <Field label="Full name"><input name="fullName" required minLength={2} maxLength={200} defaultValue={edit.row?.fullName}/></Field>
      <Field label="Email address"><input name="email" type="email" maxLength={254} defaultValue={edit.row?.email??''}/></Field>
      <Field label="Student / National ID"><input name="identityNumber" maxLength={100} defaultValue={edit.row?.identityNumber??''}/></Field>
      <Field label="Phone number"><input name="phone" maxLength={40} defaultValue={edit.row?.phone}/></Field>
      <Field label="Ticket category"><select aria-label="Ticket category" name="categoryId" required defaultValue={edit.row?.categoryId??''}><option value="">Choose category</option>{categories.data?.filter(c=>c.active||c.id===edit.row?.categoryId).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Organization"><input name="organization" maxLength={200} defaultValue={edit.row?.organization}/></Field><Field label="Notes"><textarea name="notes" maxLength={2000} defaultValue={edit.row?.notes}/></Field>
      <p>Provide an email or ID. Category cannot change after ticket history exists.</p><button className="primary" disabled={a.busy}>Save attendee</button>
    </form></Dialog>}
    {cancel&&<Confirm title="Cancel attendee" description={`Cancel ${cancel.fullName}'s registration and revoke unused tickets? Used-ticket history remains.`} close={()=>setCancel(undefined)} act={async()=>{await api.request(base+`/${cancel.id}/cancel`,'POST');setCancel(undefined);data.reload();}}/>}
    {importing&&<AttendeeImport api={api} base={base} categories={categories.data??[]} close={()=>setImporting(false)} saved={()=>{data.reload();setMessage('Attendee import completed. Tickets and email are separate.');}}/>}
  </>;
}
function AttendeeImport({api,base,categories,close,saved}:{api:Client;base:string;categories:Category[];close:()=>void;saved:()=>void}) {
  const a=useAction();const[file,setFile]=useState<File>(),[preview,setPreview]=useState<Preview>(),[confirmed,setConfirmed]=useState(false),[done,setDone]=useState(false),[key,setKey]=useState(()=>crypto.randomUUID());
  const [matching,setMatching]=useState<{headers:string[];mapping:Record<string,number>}>(),[defaultCategory,setDefaultCategory]=useState('');
  const changed=()=>{setPreview(undefined);setConfirmed(false);setKey(crypto.randomUUID());};
  const form=()=>{if(!file)throw new Error('Choose an XLSX or CSV file.');const f=new FormData();f.set('file',file);
    if(matching||defaultCategory)f.set('options',JSON.stringify({...(matching?{mapping:matching.mapping}:{}),...(defaultCategory?{defaultCategoryId:Number(defaultCategory)}:{})}));return f;};
  return <Dialog title="Import independent attendees" close={()=>{if(!a.busy)close();}}><Notice error={a.error}/>{done?<><p role="status">Import completed successfully.</p><button onClick={close}>Done</button></>:<>
    <p>Up to 5,000 new attendees. Existing event emails/IDs and file duplicates block the entire import. IDs and phones must be Text.</p>
    <Field label="Attendee file"><input type="file" accept=".csv,.xlsx" onChange={e=>{setFile(e.target.files?.[0]);setMatching(undefined);changed();}}/></Field>
    <Field label="Default import category"><select aria-label="Default import category" value={defaultCategory} onChange={e=>{setDefaultCategory(e.target.value);changed();}}><option value="">Use event default</option>{categories.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <button disabled={a.busy||!file} onClick={()=>void a.run(async()=>{setMatching(await api.request(base+'/import/columns','POST',form()));changed();})}>Change column matching</button>
    {matching&&<fieldset><legend>Match source columns</legend>{Object.entries({fullName:'Full name',email:'Email address',phone:'Phone number',identityNumber:'Student / National ID',organization:'Organization',category:'Ticket category',notes:'Notes'}).map(([field,label])=><Field key={field} label={'Source for '+label}>
      <select aria-label={'Source for '+label} value={matching.mapping[field]??''} onChange={e=>{const mapping={...matching.mapping};if(e.target.value==='')delete mapping[field];else mapping[field]=Number(e.target.value);setMatching({...matching,mapping});changed();}}><option value="">Not imported</option>{matching.headers.map((h,i)=><option key={i} value={i}>{i+1}: {h||'(blank)'}</option>)}</select></Field>)}<p>Match Full name and an email or ID. Each source column can be used once.</p></fieldset>}
    <button disabled={a.busy||!file} onClick={()=>void a.run(async()=>{setPreview(await api.request<Preview>(base+'/import/preview','POST',form()));setConfirmed(false);})}>Preview attendee import</button>
    {preview&&<><p>{preview.count} valid rows; {preview.errorCount} errors.</p>{preview.errors.length>0&&<ul>{preview.errors.map((e,i)=><li key={i}>Row {e.row}: {e.message}</li>)}</ul>}
      <details><summary>Preview first {preview.rows.length} rows</summary><ul>{preview.rows.map((r,i)=><li key={i}>{r.fullName} — {r.email||r.identityNumber}</li>)}</ul></details>
      <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this attendee import</label>
      <button className="primary" disabled={a.busy||!confirmed||preview.errorCount>0||!preview.count} onClick={()=>void a.run(async()=>{const f=form();f.set('requestKey',key);f.set('previewHash',preview.previewHash);f.set('confirmed','true');await api.request(base+'/import/commit','POST',f);setDone(true);saved();})}>Confirm attendee import</button>
    </>}
  </>}</Dialog>;
}
