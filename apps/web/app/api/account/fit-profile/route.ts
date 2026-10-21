import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { FIT_CONSENT_VERSION, parseFitFields, recommendX1Fit } from "@/lib/fit-guide";
import { deleteFitProfile, getFitProfile, saveFitProfile } from "@/lib/services/fit-profile-service";

const ownerSchema=z.object({ accountId:z.string().min(1).max(100),revision:z.number().int().min(0) });
const saveSchema=ownerSchema.extend({ heightCm:z.number().nullable(),weightKg:z.number().nullable(),waistCm:z.number().nullable(),preference:z.enum(["regular","relaxed"]),consentVersion:z.literal(FIT_CONSENT_VERSION) }).strict();
function json(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"Cache-Control":"private, no-store","Vary":"Cookie, Authorization"}})}
async function handle(request:Request,action:"get"|"save"|"delete") {
  if(appConfig.COMMERCE_STORAGE!=="prisma")return json({ok:false,error:"FIT_PROFILE_UNAVAILABLE"},503);
  const session=await readRequestUserSession(request);
  if(!session)return json({ok:false,error:"AUTH_REQUIRED"},401);
  if(action!=="get"&&!request.headers.has("authorization")){
    let originHost="";try{originHost=new URL(request.headers.get("origin")||"").host}catch{}
    if(!originHost||originHost!==request.headers.get("host"))return json({ok:false,error:"INVALID_ORIGIN"},403);
  }
  try {
    if(action==="get"){const profile=await getFitProfile(session.userId);return json({ok:true,accountId:session.userId,profile,recommendation:profile?recommendX1Fit(profile):null})}
    const raw=await request.json().catch(()=>null);
    const parsed=action==="save"?saveSchema.safeParse(raw):ownerSchema.strict().safeParse(raw);
    if(!parsed.success)return json({ok:false,error:"INVALID_FIT_PROFILE"},400);
    if(parsed.data.accountId!==session.userId)return json({ok:false,error:"SESSION_CHANGED"},409);
    if(action==="delete"){await deleteFitProfile(session.userId,parsed.data.revision);return json({ok:true,accountId:session.userId,profile:null})}
    const input=saveSchema.parse(parsed.data),values=parseFitFields(input);
    if(values.heightCm===null&&values.weightKg===null&&values.waistCm===null)return json({ok:false,error:"FIT_PROFILE_EMPTY"},400);
    const profile=await saveFitProfile(session.userId,values,input.revision);
    return json({ok:true,accountId:session.userId,profile,recommendation:recommendX1Fit(profile)});
  }catch(error){
    const code=error instanceof Error?error.message:"";
    if(code==="FIT_PROFILE_CONFLICT")return json({ok:false,error:code},409);
    if(code==="INVALID_FIT_PROFILE")return json({ok:false,error:code},400);
    return json({ok:false,error:"FIT_PROFILE_UNAVAILABLE"},503);
  }
}
export const GET=(request:Request)=>handle(request,"get");
export const PUT=(request:Request)=>handle(request,"save");
export const DELETE=(request:Request)=>handle(request,"delete");
