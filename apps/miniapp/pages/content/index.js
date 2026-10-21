import { withTapFeedback } from '../../utils/tap-feedback';
import {documents} from '../../content/documents';
import {fetchPublishedPage} from '../../services/content';
import {readPage} from '../../stores/content';
import {documentNodes} from '../../models/document-nodes';
import {normalizeManagedPageKey,navigateToManagedPage} from '../../utils/navigation';
import {config} from '../../config/index';
function currentMiniPrivacy(nodes) {
  const versions = new Set();
  function visit(value) {
    if (typeof value === 'string') {
      const text = value.replace(/<[^>]*>/g, '\n');
      for (const match of text.matchAll(/(?:^|[\r\n])[\t ]*版本[\t ]*[：:][\t ]*([^\s；;，,。<>]{1,160})/g)) versions.add(match[1]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') { if (value.type === 'text') visit(value.text); if (Array.isArray(value.children)) value.children.forEach(visit); }
  }
  visit(nodes);
  return versions.size === 1 && versions.has(config.miniProgramPrivacyVersion);
}
Page(withTapFeedback({data:{title:'',nodes:[],actions:[],source:'',syncedAt:'',version:'',notice:'',loading:false,missing:false,pageKey:'',isEditorial:false,showShoppingAction:false},
onLoad(o){this.setData({pageKey:normalizeManagedPageKey(o.pageKey),isEditorial:o.pageKey==='about'||o.pageKey==='size-guide'});},onShow(){this.load();},onPullDownRefresh(){this.load(true);},retry(){this.load(true);},
applyPage(page){const nodes=documentNodes(page);if(this.data.pageKey==='miniprogram-privacy'&&!currentMiniPrivacy(nodes))throw Error('PRIVACY_DOCUMENT_VERSION_MISMATCH');const hasShopAction=(page.document?.sections||[]).filter(s=>s.visible!==false).some(s=>s.action?.pageKey==='shop'||(s.items||[]).some(i=>i.link?.pageKey==='shop'));this.setData({showShoppingAction:this.data.isEditorial&&!hasShopAction,title:page.name||page.title||documents[this.data.pageKey]?.title||'',nodes,actions:(page.document?.sections||[]).filter(s=>s.visible!==false).flatMap(s=>[s.action,...(s.items||[]).map(i=>i.link)].filter(Boolean)).filter((a,i,list)=>list.findIndex(b=>b.pageKey===a.pageKey&&b.query===a.query)===i),source:config.apiBaseUrl+(page.path||'/'+this.data.pageKey),syncedAt:new Date(page.syncedAt||page.publishedAt||Date.now()).toLocaleString('zh-CN'),version:page.version||'',missing:false});},
async load(force=false){
  if(this.data.loading)return;this.setData({loading:true,notice:''});
  try{this.applyPage(await fetchPublishedPage(this.data.pageKey,{force}));}
  catch(e){
    const cached=readPage(this.data.pageKey,true);let applied=false;
    if(cached){try{this.applyPage(cached);this.setData({notice:'暂时无法更新，正在显示最近保存的内容。'});applied=true;}catch{}}
    if(!applied){
      const bundled=documents[this.data.pageKey];
      if(this.data.pageKey==='miniprogram-privacy'&&(!bundled||!currentMiniPrivacy(bundled.nodes)))this.setData({nodes:[],actions:[],source:'',version:'',missing:true,notice:'内容加载失败，请重试。'});
      else this.setData(bundled?{title:bundled.title,showShoppingAction:this.data.isEditorial,nodes:bundled.nodes,source:bundled.source,syncedAt:bundled.syncedAt,missing:false,notice:'暂时无法连接，正在显示随小程序保存的版本。'}:{missing:true,notice:'内容加载失败，请重试。'});
    }
  }finally{this.setData({loading:false});wx.stopPullDownRefresh();}
},openLink(e){navigateToManagedPage(e.currentTarget.dataset.link);},openContact(){wx.navigateTo({url:'/pages/contact/index'});},goShopping(){navigateToManagedPage('shop');},copySource(){if(this.data.source)wx.setClipboardData({data:this.data.source});}}, ["retry","openLink","goShopping","openContact","copySource"]));
