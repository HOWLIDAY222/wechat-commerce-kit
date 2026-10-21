const original=globalThis.fetch;
globalThis.fetch=(input,...args)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return Promise.reject(Error('External network forbidden in community tests'));
  return original(input,...args);
};
