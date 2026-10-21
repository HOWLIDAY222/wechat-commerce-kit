import { parseFitFields } from '../utils/fit-guide';
import { packageCare } from './package-service';

function range(text) {
  const match=String(text||'').match(/(\d+(?:\.\d+)?)\s*[-–—~～至]\s*(\d+(?:\.\d+)?)/);
  return match&&Number(match[1])<Number(match[2])?[Number(match[1]),Number(match[2])]:null;
}
function row(size,waist,weight) {
  return {size,waistMin:waist[0],waistMax:waist[1],weightMin:weight?.[0]??null,weightMax:weight?.[1]??null,waistLabel:waist.join('–'),weightLabel:weight?weight.join('–'):'—'};
}
export function publishedSizeGuide(page,product) {
  const sections=(page?.document?.sections||[]).filter(section=>section.visible!==false).slice().sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
  const items=sections.flatMap(section=>(section.items||[]).filter(item=>item.visible!==false));
  const tips=items.filter(item=>['size-waist','size-hip','size-fit','live-size-note'].includes(item.id)).map(item=>({id:item.id,title:item.title||'',body:item.body||''}));
  // This published guide explicitly describes X1 Air. Never apply it to a different product.
  if(product?.slug!=='x1-air-white')return {rows:[],tips};
  const allowed=new Set((product.sizes||[]).map(size=>String(size).toUpperCase())),found=new Map();
  for(const item of items){
    const table=item.table;
    if(!table||!Array.isArray(table.headers)||!Array.isArray(table.rows))continue;
    const sizeColumn=table.headers.findIndex(header=>/^(尺码|size)$/i.test(String(header).trim()));
    const waistColumn=table.headers.findIndex(header=>/腰围|waist/i.test(String(header)));
    const weightColumn=table.headers.findIndex(header=>/体重|weight/i.test(String(header)));
    if(sizeColumn<0||waistColumn<0)continue;
    for(const cells of table.rows){
      const size=String(cells[sizeColumn]||'').trim().toUpperCase(),waist=range(cells[waistColumn]),weight=weightColumn>=0?range(cells[weightColumn]):null;
      if(waist&&allowed.has(size))found.set(size,row(size,waist,weight));
    }
  }
  for(const item of items){
    const size=String(item.title||'').trim().toUpperCase();if(!allowed.has(size)||found.has(size))continue;
    const body=String(item.body||'');
    const waist=range(body.match(/(?:人体)?腰围\s*([^；;。\n]+?)(?:cm|厘米)/i)?.[1]);
    const weight=range(body.match(/(?:参考)?体重\s*([^；;。\n]+?)(?:kg|公斤|千克)/i)?.[1]);
    if(waist)found.set(size,row(size,waist,weight));
  }
  return {rows:[...found.values()].sort((a,b)=>a.waistMin-b.waistMin||a.waistMax-b.waistMax),tips};
}

export function queryPublishedSize(rows,fields) {
  if(!String(fields.waistCm??'').trim())throw Error('WAIST_REQUIRED');
  let waist,values;
  try{waist=parseFitFields({waistCm:fields.waistCm});}catch{throw Error('INVALID_WAIST');}
  try{values=parseFitFields({...fields,waistCm:waist.waistCm});}catch{throw Error('INVALID_WEIGHT');}
  const matches=rows.filter(item=>values.waistCm>=item.waistMin&&values.waistCm<=item.waistMax);
  if(!matches.length)return {status:'outside',recommended:'',candidates:[],weightMismatch:false,title:'超出当前尺码范围',detail:rows.length?`当前腰围参考范围 ${Math.min(...rows.map(item=>item.waistMin))}–${Math.max(...rows.map(item=>item.waistMax))} cm，请联系客服确认。`:'该商品尺码表暂未发布。'};
  const selected=values.preference==='relaxed'?matches[matches.length-1]:matches[0];
  const mismatch=values.weightKg!==null&&selected.weightMin!==null&&(values.weightKg<selected.weightMin||values.weightKg>selected.weightMax),boundary=matches.length>1;
  return {status:boundary?'boundary':'matched',recommended:selected.size,candidates:matches.map(item=>item.size),weightMismatch:mismatch,title:`参考 ${selected.size} 码`,detail:mismatch?'体重与该码参考范围不同，建议联系客服确认。':boundary?`位于两码交界，已按${values.preference==='relaxed'?'宽松':'合身'}偏好选择。`:`适合人体腰围 ${selected.waistLabel} cm。`};
}

export function careGuide(product) {
  const care=packageCare(product);if(!care)return null;
  const noticeRows=care.rows.filter(item=>/^(?:具体洗护要求)?以.*洗标.*为准$/.test(item.text));
  const instructions=care.rows.filter(item=>!noticeRows.includes(item));if(!instructions.length)return null;
  const cards=instructions.map(item=>{
    let icon='care-info',kind='other',label='';
    if(/漂白/.test(item.text)&&/不可|勿|禁止|不要/.test(item.text)){icon='care-no-bleach';kind='bleach';}
    else if(/烘干/.test(item.text)&&/不可|勿|禁止|不要/.test(item.text)){icon='care-no-dry';kind='dryer';}
    else if(/晾干|阴凉|平摊/.test(item.text)){icon='care-shade';kind='dry';}
    else if(/洗涤|手洗|机洗/.test(item.text)){icon='package-care';kind='wash';label=item.text.match(/\d+(?:\.\d+)?\s*℃/)?.[0]||'';}
    return {id:item.id,text:item.text,icon:'/assets/icons/'+icon+'.png',kind,label};
  });
  const steps=[];
  if(noticeRows.length)steps.push({id:'label',title:'先确认洗标',body:noticeRows.map(item=>item.text).join('；')});
  const washes=cards.filter(item=>item.kind==='wash');if(washes.length)steps.push({id:'wash',title:'轻柔清洗',body:washes.map(item=>item.text).join('；')});
  const bleach=cards.filter(item=>item.kind==='bleach');if(bleach.length)steps.push({id:'bleach',title:'洗涤时注意',body:bleach.map(item=>item.text).join('；')});
  const dry=cards.filter(item=>item.kind==='dryer'||item.kind==='dry');if(dry.length)steps.push({id:'dry',title:'洗后晾干',body:dry.map(item=>item.text).join('；')});
  const other=cards.filter(item=>item.kind==='other');if(other.length)steps.push({id:'other',title:'其他洗护要求',body:other.map(item=>item.text).join('；')});
  return {title:care.title,cards,steps,notice:noticeRows.map(item=>item.text).join('；')};
}
