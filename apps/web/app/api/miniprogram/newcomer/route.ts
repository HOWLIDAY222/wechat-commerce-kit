import {getMemberPromotions} from '@/lib/services/member-promotions-service';
import {NextResponse} from 'next/server';
import {readBearerUserSession} from '@/lib/auth/session';
import {getNewcomerOffer} from '@/lib/services/newcomer-service';

export async function GET(request:Request){
  const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
  const session=request.headers.has('authorization')?await readBearerUserSession(request):null;
  if(request.headers.has('authorization')&&!session)return json({ok:false,error:'AUTH_REQUIRED'},401);
  try{const [offer,promotions]=await Promise.all([getNewcomerOffer(session?.userId),getMemberPromotions()]);return json({ok:true,offer,promotions});}
  catch{return json({ok:false,error:'NEWCOMER_OFFER_FAILED'},503);}
}
