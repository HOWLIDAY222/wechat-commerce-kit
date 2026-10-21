import Link from 'next/link';
import {redirect} from 'next/navigation';
import {AdminFrame} from '@/app/admin/_components/admin-frame';
import {readCurrentAdminSession} from '@/lib/auth/session';
import {prisma} from '@/lib/db/prisma';
import type {Prisma} from '@prisma/client';
export const dynamic='force-dynamic';
export default async function AuditPage({searchParams}:{searchParams:Promise<{q?:string;targetId?:string;page?:string}>}){
 const session=await readCurrentAdminSession();if(!session)redirect('/admin/login');if(session.role!=='owner')redirect('/admin');
 const p=await searchParams,q=(p.q||'').trim().slice(0,100),page=Math.max(1,Math.min(10000,Number(p.page)||1));
 const users=q?await prisma.user.findMany({where:{OR:[{name:{contains:q,mode:'insensitive'}},{phone:{contains:q}}]},select:{id:true},take:100}):[];
 const where:Prisma.AuditLogWhereInput={...(p.targetId?{targetId:p.targetId}:{}),...(q?{OR:[{action:{contains:q,mode:'insensitive'}},{targetId:{contains:q,mode:'insensitive'}},{actorId:{in:users.map(u=>u.id)}},{actorId:{contains:q,mode:'insensitive'}}]}:{})};
 const [count,rows]=await Promise.all([prisma.auditLog.count({where}),prisma.auditLog.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*30,take:30})]);
 const actors=await prisma.user.findMany({where:{id:{in:rows.map(r=>r.actorId).filter((id):id is string=>!!id)}},select:{id:true,name:true}}),names=new Map(actors.map(u=>[u.id,u.name]));
 const href=(n:number)=>'/admin/audit?'+new URLSearchParams({q,targetId:p.targetId||'',page:String(n)});
 return <AdminFrame active="settings" title="操作记录" subtitle="按商品、订单、操作或操作人查找，并展开查看变更详情。" metrics={[{label:'匹配记录',value:String(count)}]}><section className="rounded-lg border bg-white p-5"><form className="flex flex-wrap gap-3"><input type="hidden" name="targetId" value={p.targetId||''}/><input className="rounded border px-3 py-2" name="q" defaultValue={q} aria-label="搜索操作记录" placeholder="操作人、对象编号或操作名称"/><button className="vk-button vk-button-dark">搜索</button><Link className="vk-button vk-button-light" href="/admin/audit">清空筛选</Link></form><div className="mt-6 grid gap-4">{rows.map(r=><details className="rounded border p-4" key={r.id}><summary className="cursor-pointer text-sm">{r.createdAt.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · {names.get(r.actorId||'')||r.actorId||'系统'} · {r.action}<span className="block mt-2 break-all text-slate-500">{r.targetType}：{r.targetId}</span></summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3 text-xs">{JSON.stringify(r.detail,null,2)||'无附加详情'}</pre></details>)}{!rows.length&&<p>没有符合条件的记录。</p>}</div><nav className="mt-5 flex items-center gap-5">{page>1&&<Link href={href(page-1)}>上一页</Link>}<span>第 {page} 页 / {Math.max(1,Math.ceil(count/30))} 页</span>{page*30<count&&<Link href={href(page+1)}>下一页</Link>}</nav></section></AdminFrame>;
}
