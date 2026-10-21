// Track image state by source; retry remounts the failed image without changing its URL.
export const mediaFeedback={
  onUnload(){this.unloaded=true;},
  onMediaLoad(event){
    const source=event.currentTarget.dataset.source;
    if(!source||(this.data.mediaLoaded?.[source]&&!this.data.mediaFailed?.[source]))return;
    this.setData({mediaLoaded:{...this.data.mediaLoaded,[source]:true},mediaFailed:{...this.data.mediaFailed,[source]:false}});
  },
  onMediaError(event){const source=event.currentTarget.dataset.source;if(source)this.setData({mediaFailed:{...this.data.mediaFailed,[source]:true}});},
  onMediaRetry(event){
    const source=event.currentTarget.dataset.source;if(!source||this.data.mediaRetrying?.[source])return;
    this.setData({mediaRetrying:{...this.data.mediaRetrying,[source]:true},mediaLoaded:{...this.data.mediaLoaded,[source]:false},mediaFailed:{...this.data.mediaFailed,[source]:false}});
    const remount=()=>{if(!this.unloaded)this.setData({mediaRetrying:{...this.data.mediaRetrying,[source]:false}});};
    if(wx.nextTick)wx.nextTick(remount);else setTimeout(remount,0);
  },
};
