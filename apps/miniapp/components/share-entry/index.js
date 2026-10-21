import { withTapFeedback } from '../../utils/tap-feedback';
import { directShareImage, enablePublicSharing } from '../../utils/sharing';
import { loadLocalShareImage } from '../../utils/share-image';

const covers = new Map();

Component(withTapFeedback({
  properties: { source: String, singlePage: Boolean, tabPage: Boolean },
  data: { open: false, timelineGuide: false },
  observers: { source() { this.prepareCover(); } },
  lifetimes: {
    ready() { this.canvasReady = true; this.prepareCover(); },
    detached() { this.disposed = true; this.coverGeneration = (this.coverGeneration || 0) + 1; },
  },
  pageLifetimes: { hide() { this.closeShare(); } },
  methods: {
    openShare() {
      enablePublicSharing();
      if (this.properties.tabPage && wx.hideTabBar) wx.hideTabBar({ animation: false, fail() {} });
      this.setData({ open: true, timelineGuide: false });
    },
    closeShare() {
      if ((this.data.open || this.data.timelineGuide) && this.properties.tabPage && wx.showTabBar) wx.showTabBar({ animation: false, fail() {} });
      this.setData({ open: false, timelineGuide: false });
    },
    stopShare() {},
    shareFriend() { this.closeShare(); },
    guideTimeline() { enablePublicSharing(); this.setData({ open: false, timelineGuide: true }); },
    prepareCover() {
      const source = this.properties.source;
      if (!this.canvasReady || this.properties.singlePage || !source || source === this.preparingSource) return;
      this.preparingSource = source;
      const generation = this.coverGeneration = (this.coverGeneration || 0) + 1;
      this.lastCoverError = '';
      const ready = path => {
        if (this.disposed || generation !== this.coverGeneration) return;
        this.triggerEvent('coverready', { source, path });
      };
      if (covers.has(source)) { ready(covers.get(source)); return; }
      const direct = directShareImage(source);
      if (direct) ready(direct);
      // Prepare a small square JPG, including when uploaded photos are WebP.
      if (!wx.canvasToTempFilePath) return;
      return loadLocalShareImage(source).then(({ path, release }) => {
        if (this.disposed || generation !== this.coverGeneration) { release(); return; }
        const fail = error => { this.lastCoverError = String(error?.errMsg || error?.message || 'SHARE_COVER_UNAVAILABLE'); release(); };
        try { this.createSelectorQuery().select('#share-cover-canvas').fields({ node: true, size: true }).exec(result => {
          if (this.disposed || generation !== this.coverGeneration) { release(); return; }
          const canvas = result[0]?.node;
          if (!canvas?.createImage) { release(); return; }
          canvas.width = 500; canvas.height = 500;
          const ctx = canvas.getContext('2d'), image = canvas.createImage();
          image.onerror = fail;
          image.onload = () => {
            if (this.disposed || generation !== this.coverGeneration) { release(); return; }
            try {
            if (!(image.width > 0 && image.height > 0)) throw new Error('INVALID_SHARE_IMAGE_DIMENSIONS');
            const scale = Math.min(500 / image.width, 500 / image.height);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 500, 500);
            ctx.drawImage(image, (500 - image.width * scale) / 2, (500 - image.height * scale) / 2, image.width * scale, image.height * scale);
            wx.canvasToTempFilePath({ canvas, fileType: 'jpg', quality: 0.85, fail, complete: release, success: response => {
              if (this.disposed || generation !== this.coverGeneration) return;
              if (covers.size >= 8) covers.delete(covers.keys().next().value);
              covers.set(source, response.tempFilePath); ready(response.tempFilePath);
            } }, this);
            } catch (error) { fail(error); }
          };
          image.src = path;
        }); } catch (error) { fail(error); }
      }).catch(error => { this.lastCoverError = String(error?.errMsg || error?.message || 'SHARE_COVER_UNAVAILABLE'); });
    },
  },
}, ["openShare","closeShare","shareFriend","guideTimeline"], {"component":true}));
