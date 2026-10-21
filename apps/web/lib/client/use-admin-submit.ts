"use client";
import {useRef,useState,type FormEvent} from 'react';
export function useAdminSubmit(report:(status:{tone:'idle'|'success'|'error';message:string})=>void){
 const lock=useRef(false);const [busy,setBusy]=useState(false);
 const guard=(handler:(e:FormEvent<HTMLFormElement>)=>Promise<void>)=>async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);try{await handler(e);}catch(error){report({tone:'error',message:error instanceof Error&&/[一-鿿]/.test(error.message)?error.message:'连接中断或输入无效，请核对记录后重试。'});}finally{lock.current=false;setBusy(false);}};
 return {busy,guard};
}
