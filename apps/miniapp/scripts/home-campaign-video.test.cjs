const test=require('node:test');
const assert=require('node:assert/strict');
const {createLoader}=require('./test-loader.cjs');

function home(wx={}){
  const loader=createLoader(wx);loader.load('pages/home/home.js');
  const page=loader.page;page.data=structuredClone(page.data);page.setData=value=>Object.assign(page.data,value);return page;
}

test('home video automatically starts muted only when its hero is visible',()=>{
  const page=home();
  assert.equal(page.data.campaignVideoMounted,false);
  page.homeVisible=true;page.onCampaignVisibility(true);
  assert.equal(page.data.campaignVideoMounted,true);
  assert.equal(page.data.campaignVideoMuted,true);
  page.toggleCampaignSound();assert.equal(page.data.campaignVideoMuted,false);
  page.toggleCampaignSound();assert.equal(page.data.campaignVideoMuted,true);
});

test('scrolling the hero offscreen pauses playback and returning restarts it muted',()=>{
  const calls=[];const page=home({nextTick:fn=>fn(),createVideoContext:()=>({pause:()=>calls.push('pause'),play:()=>calls.push('play')})});
  page.homeVisible=true;page.onCampaignVisibility(true);page.toggleCampaignSound();
  page.onCampaignVisibility(false);assert.equal(calls.at(-1),'pause');
  page.onCampaignVisibility(true);assert.equal(calls.at(-1),'play');assert.equal(page.data.campaignVideoMuted,true);
  page.onHide();assert.equal(page.homeVisible,false);assert.equal(calls.at(-1),'pause');
});

test('the native visibility observer disconnects on page hide and cannot restart hidden playback',()=>{
  let callback;let disconnected=0;const calls=[];
  const page=home({nextTick:fn=>fn(),createIntersectionObserver:()=>({relativeToViewport(){return this;},observe:(selector,fn)=>{assert.equal(selector,'.campaign-video-frame');callback=fn;},disconnect:()=>disconnected++}),createVideoContext:()=>({pause:()=>calls.push('pause'),play:()=>calls.push('play')})});
  page.homeVisible=true;page.data.campaignSectionId='home-hero';page.observeCampaignVideo();
  callback({intersectionRatio:.5});assert.equal(page.data.campaignVideoMounted,true);
  page.onHide();assert.equal(disconnected,1);
  callback({intersectionRatio:.5});assert.equal(calls.includes('play'),false);assert.equal(page.homeVisible,false);
});

test('leaving home pauses an active film while preserving existing image cleanup',()=>{
  const calls=[];const page=home({createVideoContext:(id,owner)=>{calls.push({id,owner});return {pause:()=>calls.push('paused')};}});
  page.onHide();assert.equal(calls.length,0);
  page.openCampaignVideo();page.onHide();
  assert.equal(calls[0].id,'home-campaign-video');assert.equal(calls[0].owner,page);assert.equal(calls[1],'paused');
  page.onUnload();assert.equal(page.unloaded,true);assert.equal(calls[3],'paused');
});

test('a failed home film leaves content and purchase selection available and can retry',()=>{
  const page=home();page.setData({product:{slug:'x1-air-white'},sections:[{id:'hero'}],introductionAnchor:'home-section-1'});
  page.openCampaignVideo();page.toggleCampaignSound();page.onCampaignVideoError();
  assert.equal(page.data.campaignVideoMounted,false);assert.equal(page.data.campaignVideoFailed,true);
  assert.equal(page.data.product.slug,'x1-air-white');assert.equal(page.data.sections.length,1);assert.equal(page.data.introductionAnchor,'home-section-1');
  page.openCampaignVideo();assert.equal(page.data.campaignVideoMounted,true);assert.equal(page.data.campaignVideoFailed,false);assert.equal(page.data.campaignVideoMuted,true);
});

test('a late video error does not update a disposed home page',()=>{
  const page=home();page.onUnload();page.setData=()=>assert.fail('disposed page must not be updated');page.onCampaignVideoError();
});

test('home poster loader clears on load, error or bounded timeout',()=>{
  const page=home();assert.equal(page.data.campaignPosterLoading,true);
  const event={currentTarget:{dataset:{source:page.data.campaignVideoPoster}}};
  page.onCampaignPosterLoad(event);assert.equal(page.data.campaignPosterLoading,false);
  page.setData({campaignPosterLoading:true});page.onCampaignPosterError(event);assert.equal(page.data.campaignPosterLoading,false);
  page.setData({campaignPosterLoading:true});page.onCampaignPosterTimeout();assert.equal(page.data.campaignPosterLoading,false);
  assert.equal(page.data.mediaFailed[page.data.campaignVideoPoster],true);
});

test('home waiting indicator clears immediately and repeated time updates do not redraw',()=>{
  const page=home();page.openCampaignVideo();assert.equal(page.data.campaignVideoLoading,true);
  page.onCampaignVideoReady();assert.equal(page.data.campaignVideoLoading,false);
  let writes=0;const setData=page.setData;page.setData=value=>{writes++;setData(value);};
  page.onCampaignVideoReady();assert.equal(writes,0);
  page.onCampaignVideoWaiting();assert.equal(page.data.campaignVideoLoading,true);
  page.onCampaignVideoError();assert.equal(page.data.campaignVideoLoading,false);assert.equal(page.data.campaignVideoMounted,false);
});
