import type { Context } from '@netlify/functions';
import { eq, and } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { database } from '../../db/index.js';
import { garages, revisions } from '../../db/schema.js';
export default async (req: Request, context: Context) => {
  const headers = {'Cache-Control':'no-store'};
  if (!['GET','PUT','POST'].includes(req.method)) return new Response(null,{status:405});
  if (req.method !== 'GET' && req.headers.get('origin') !== new URL(req.url).origin) return new Response(null,{status:403});
  let id = context.cookies.get('mg_session');
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) {
    id = randomUUID();
    context.cookies.set({name:'mg_session',value:id,path:'/',httpOnly:true,secure:true,sameSite:'Strict',maxAge:31536000});
  }
  try {
    const db=database();
    const blobs=getStore({name:'garage-attachments',consistency:'strong'});
    if(new URL(req.url).pathname==='/api/file') {
      if(req.method==='GET') {
        const key=new URL(req.url).searchParams.get('key')||'';
        if(!key.startsWith(id+'/')||!/^[a-f0-9-]{36}\/[a-f0-9]{64}$/.test(key))return new Response(null,{status:404});
        const data=await blobs.get(key);
        if(data===null)return new Response(null,{status:404});
        return new Response(data,{headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
      }
      if(req.method!=='POST')return new Response(null,{status:405});
      const data=await req.text();
      if(data.length>4_500_000 || !/^data:(image\/(jpeg|png|webp|gif)|application\/pdf);base64,[A-Za-z0-9+/=\s]+$/.test(data)) return new Response(null,{status:400});
      const key=id+'/'+createHash('sha256').update(data).digest('hex');
      await blobs.set(key,data);
      return Response.json({__mgAttachment:key},{headers});
    }
    if(req.method==='POST')return new Response(null,{status:405});
    async function transform(value: any, restore=false): Promise<any> {
      if (typeof value==='string' && !restore && /^data:(image\/|application\/pdf)/.test(value)) {
        const key=id+'/'+createHash('sha256').update(value).digest('hex');
        await blobs.set(key,value); return {__mgAttachment:key};
      }
      if(!restore && value && typeof value==='object' && typeof value.__mgAttachment==='string' && !value.__mgAttachment.startsWith(id+'/'))throw Error('Invalid attachment');
      if (restore && value && typeof value==='object' && typeof value.__mgAttachment==='string') {
        if (!value.__mgAttachment.startsWith(id+'/')) throw Error('Invalid attachment');
        const data=await blobs.get(value.__mgAttachment); if(data===null)throw Error('Missing attachment');return data;
      }
      if(Array.isArray(value))return Promise.all(value.map(x=>transform(x,restore)));
      if(value && typeof value==='object') {const out:any={};for(const [k,v] of Object.entries(value))out[k]=await transform(v,restore);return out;}
      return value;
    }
    const [current]=await db.select().from(garages).where(eq(garages.id,id));
    if(req.method==='GET') return Response.json({data:current?.data||null,revision:current?.revision||0},{headers});
    const body=await req.json(); const data=body.data;
    if(!data || !Array.isArray(data.vehicles) || !Array.isArray(data.carRecords))return Response.json({error:'Некоректні дані'},{status:400,headers});
    if(body.revision!==(current?.revision||0))return Response.json({error:'Дані змінено в іншій вкладці. Експортуйте поточні зміни та перезавантажте сторінку.'},{status:409,headers});
    const stored=await transform(data);
    const next=(current?.revision||0)+1;
    if(current){
      await db.insert(revisions).values({id:randomUUID(),garageId:id,data:current.data});
      const result=await db.update(garages).set({data:stored,revision:next,updatedAt:new Date()}).where(and(eq(garages.id,id),eq(garages.revision,current.revision))).returning();
      if(!result.length)return Response.json({error:'Дані змінено в іншій вкладці. Збережіть JSON-копію та перезавантажте сторінку.'},{status:409,headers});
    }else await db.insert(garages).values({id,data:stored,revision:next});
    return Response.json({revision:next},{headers});
  }catch {return Response.json({error:'Сховище недоступне. Зміни залишаються на екрані: створіть JSON-копію та повторіть збереження.'},{status:503,headers});}
};
export const config={path:['/api/garage','/api/file']};
