import { z } from 'zod';
import { parse } from '../students/validation.js';
export const listPage=(query:unknown)=>parse(z.object({
  after:z.coerce.number().int().min(0).max(2147483647).default(0),search:z.string().trim().max(200).default(''),
  status:z.enum(['all','active','cancelled','Registered','Cancelled']).default('all'),
  kind:z.enum(['students','guests']).optional(),studentId:z.coerce.number().int().positive().max(2147483647).optional(),
  group:z.string().max(200).optional(),
}).strict(),query);
export function pageResult<T extends {id:number}>(rows:T[]){return {rows:rows.slice(0,50),nextAfter:rows.length>50?rows[49].id:null};}
