export class ApiError extends Error {constructor(message:string,readonly status:number) {super(message);}}
export async function api<T>(route:string,token?:string,body?:unknown):Promise<T> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try {
    const base=(import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/,'');
    const response=await fetch(base+'/scanner/'+route,{method:body===undefined ? 'GET':'POST',cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal,
      headers:{...(token ? {Authorization:'Bearer '+token}:{}),...(body!==undefined ? {'Content-Type':'application/json'}:{})},
      body:body!==undefined ? JSON.stringify(body):undefined});
    if (response.status===204) return undefined as T;
    const value=await response.json();
    if (!response.ok) throw new ApiError(value.message ?? 'Request failed.',response.status);
    return value;
  } finally {clearTimeout(timer);}
}
