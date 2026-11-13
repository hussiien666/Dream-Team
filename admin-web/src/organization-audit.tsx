import { useState } from 'react';
import type { Client } from './api';
import { Notice, Loading, useAction, useResource } from './ui';
type Page={rows:{id:number;eventId:number|null;createdAt:string;action:string;actor:string;details:string}[];nextBefore:number|null;notice:string};
export function OrganizationAudit({api}:{api:Client}) {
  const [before,setBefore]=useState<number>(),[previous,setPrevious]=useState<(number|undefined)[]>([]);
  const data=useResource<Page>(api,'organization/audit'+(before?'?before='+before:'')),a=useAction();
  return <><h1>Organization audit history</h1><Notice error={a.error||data.error}/>
    <p>Recorded actions across your organization, including retained event history.</p>
    <div className="actions"><button onClick={data.reload}>Refresh audit history</button><button disabled={a.busy} onClick={()=>void a.run(async()=>{
      const blob=await api.request<Blob>('organization/audit/export','GET',undefined,undefined,true),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='organization-audit.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    })}>Export organization audit CSV</button></div>
    {data.loading?<Loading/>:data.data&&<><p>{data.data.notice}</p><div className="table-wrap"><table><thead><tr><th>Time UTC</th><th>Event ID</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead>
      <tbody>{data.data.rows.map(row=><tr key={row.id}><td>{new Date(row.createdAt).toISOString()}</td><td>{row.eventId??'Organization'}</td><td>{row.action}</td><td>{row.actor}</td><td>{row.details}</td></tr>)}</tbody></table></div>
      {!data.data.rows.length&&<p>No scoped audit entries yet.</p>}<div className="actions">
      <button disabled={!previous.length} onClick={()=>{setBefore(previous.at(-1));setPrevious(previous.slice(0,-1));}}>Newer entries</button>
      <button disabled={!data.data.nextBefore} onClick={()=>{setPrevious([...previous,before]);setBefore(data.data!.nextBefore!);}}>Older entries</button></div></>}
  </>;
}
