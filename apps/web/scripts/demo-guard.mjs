export function requireLocalDemoDatabase(value,kind='demo'){
  const url=new URL(value||'');
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Only an explicit loopback demo/test PostgreSQL database is allowed');
  const allowed=kind==='test'?/^\/merchantkit_test$/:/^\/merchantkit_(?:demo|test)$/;
  if(!allowed.test(url.pathname))throw Error('Use the dedicated merchantkit_demo or merchantkit_test database');
  return url;
}
