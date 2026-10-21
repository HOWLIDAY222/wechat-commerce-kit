import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sharp=createRequire(path.join(root,'apps/web/package.json'))('sharp');
const files=JSON.parse(fs.readFileSync(path.join(root,'examples/demo-assets.json'),'utf8'));
for(const relative of files){
  const file=path.resolve(root,relative);if(!file.startsWith(root+path.sep)||(!/^apps\/(web\/public|miniapp\/assets)\//.test(relative)&&relative!=='apps/web/app/icon.png'))throw Error('Asset destination outside demo tree');
  const logo=/wordmark|logo/.test(relative),invite=/invite/.test(relative);
  const width=logo?900:invite?500:800,height=logo?160:invite?400:1000;
  const color=/black/.test(relative)?'#303030':/gray/.test(relative)?'#9b9b9b':'#fafafa';
  const svg=logo?`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="20" y="116" font-size="110" font-family="Arial,sans-serif" fill="#181818">MerchantKit</text></svg>`:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 800 1000"><rect width="800" height="1000" fill="#efefed"/><text x="70" y="120" fill="#222" font-size="45" font-family="Arial,sans-serif">MerchantKit</text><rect x="135" y="300" width="530" height="80" rx="10" fill="${color}" stroke="#b6b6b2" stroke-width="5"/><path d="M145 380 L655 380 Q620 600 485 660 L315 660 Q180 600 145 380Z" fill="${color}" stroke="#b6b6b2" stroke-width="5"/><path d="M270 395 Q300 560 350 630 M530 395 Q500 560 450 630" fill="none" stroke="#c9c9c5" stroke-width="3"/><text x="400" y="850" text-anchor="middle" fill="#73736f" font-size="30" font-family="Arial,sans-serif">DEMO PRODUCT</text></svg>`;
  fs.mkdirSync(path.dirname(file),{recursive:true});let pipeline=sharp(Buffer.from(svg));
  const ext=path.extname(file).toLowerCase();if(ext==='.svg'){fs.writeFileSync(file,svg);continue;}if(ext==='.webp')pipeline=pipeline.webp({quality:75});else if(ext==='.jpg'||ext==='.jpeg')pipeline=pipeline.jpeg({quality:80});else pipeline=pipeline.png();await pipeline.toFile(file);
}
console.log(`Generated ${files.length} original demo graphics; no source photos used.`);
