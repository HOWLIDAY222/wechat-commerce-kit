import { randomBytes, scryptSync } from 'node:crypto';
import { prisma } from '../lib/db/prisma';
import { catalogProducts } from '../lib/catalog';
async function main(){
const url=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost'].includes(url.hostname)||!/^\/merchantkit_(demo|test)$/.test(url.pathname)||process.env.DEMO_SEED!=='true')throw Error('DEMO_DATABASE_REQUIRED');
const password=process.env.DEMO_ADMIN_PASSWORD;
if(!password||password.length<16)throw Error('Set a local DEMO_ADMIN_PASSWORD of at least 16 characters before seeding');
try{
  if(await prisma.user.count()||await prisma.order.count()||await prisma.product.count())throw Error('Existing demo data preserved. Seeding requires an empty dedicated database.');
  for(const item of catalogProducts){await prisma.product.create({data:{slug:item.slug,code:item.code,name:item.name,summary:item.summary,description:item.description,category:item.category,scene:item.scene,image:item.image,status:'ACTIVE',saleMode:'IN_STOCK',showPrice:true,careInstructions:item.careInstructions,features:item.features||[],images:{create:item.images.map((imageUrl,sortOrder)=>({imageUrl,alt:'Fictional demo product',sortOrder}))},skus:{create:item.sizes.map(size=>({skuCode:item.code+'-WHITE-'+size,color:'白色',size,priceCents:item.priceCents,stockQuantity:100,status:'ACTIVE'}))}}});}
  const salt=randomBytes(16).toString('hex');
  await prisma.user.create({data:{name:'演示负责人',phone:'13900000001',role:'OWNER',status:'ACTIVE',passwordSalt:salt,passwordHash:scryptSync(password,salt,64).toString('hex')}});
  await prisma.siteSetting.create({data:{key:'commerceMode',value:'OPEN'}});
  await prisma.siteSetting.createMany({data:[
    {key:'shippingFeeCents',value:0},
    {key:'shippingRemoteFeeCents',value:0},
    {key:'shippingFarRemoteFeeCents',value:0},
  ]});
  console.log('Created fictional catalog and a local demo owner. No credentials are printed.');
}finally{await prisma.$disconnect();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'DEMO_SEED_FAILED');process.exitCode=1;});
