import {NextResponse} from 'next/server';
import {z} from 'zod';
import {revalidatePath} from 'next/cache';
import {readCurrentAdminSession} from '@/lib/auth/session';
import {createGiftTemplate,toggleGiftTemplate,issueGift,requestGiftRefund} from '@/lib/services/gift-card-service';

const id=z.string().min(1).max(100);
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),requestId:z.uuid(),title:z.string().trim().min(2).max(60),productId:id,style:z.string().min(1).max(31),quantity:z.number().int().min(1).max(99)}),
  z.object({action:z.literal('toggle'),id,active:z.boolean()}),
  z.object({action:z.literal('issue'),requestId:z.uuid(),templateId:id,userId:id,reason:z.string().trim().min(2).max(200)}),
  z.object({action:z.literal('refund'),id,reason:z.string().trim().min(2).max(200)}),
]);
export async function POST(request:Request){
  const session=await readCurrentAdminSession();if(!session)return NextResponse.json({ok:false,error:'请先登录后台。'},{status:401});
  if(session.role!=='owner')return NextResponse.json({ok:false,error:'礼品卡设置与发放仅限负责人操作。'},{status:403});
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({ok:false,error:'请检查必填信息。'},{status:400});
  const input=parsed.data;
  try{
    if(input.action==='create')await createGiftTemplate(session.userId,input);
    else if(input.action==='toggle')await toggleGiftTemplate(session.userId,input.id,input.active);
    else if(input.action==='issue')await issueGift(session.userId,input);
    else {const result=await requestGiftRefund(session.userId,input.id,input.reason,true);revalidatePath('/admin/gifts');return NextResponse.json({ok:true,...result});}
    revalidatePath('/admin/gifts');return NextResponse.json({ok:true});
  }catch(error){const code=error instanceof Error?error.message:'';const labels:Record<string,string>={
    GIFT_REQUEST_CHANGED:'上一次提交的信息已变化，请刷新后重试。',GIFT_PRODUCT_UNAVAILABLE:'商品或规格已不可用。',GIFT_SPEC_INVALID:'请选择有效款式和条数。',
    GIFT_PRICE_CHANGED:'商品价格已变化，请新建礼品卡草稿。',GIFT_CUSTOMER_REQUIRED:'请选择有效顾客账号。',GIFT_REFUND_UNAVAILABLE:'卡已兑换或不符合退款条件，请查看关联订单。',
  };return NextResponse.json({ok:false,error:labels[code]||'操作失败，请刷新后核对状态。'},{status:400});}
}
