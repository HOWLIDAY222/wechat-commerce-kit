import { config } from '../config/index';

export function loadLocalShareImage(source) {
  return new Promise((resolve, reject) => {
    // Product photos use the store's existing request domain. Never attach login headers.
    if (typeof source !== 'string' || !source.startsWith(config.apiBaseUrl + '/')) {
      reject(new Error('UNSUPPORTED_SHARE_IMAGE_ORIGIN')); return;
    }
    const fs = wx.getFileSystemManager();
    const fileBase = wx.env.USER_DATA_PATH + '/vk-share-source-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    let filePath = '';
    let released = false;
    const release = () => { if (filePath && !released) { released = true; fs.unlink({ filePath, fail() {} }); } };
    wx.request({
      url: source, responseType: 'arraybuffer', timeout: 8000, enableHttp2: true,
      header: { Accept: 'image/jpeg,image/png,image/webp' },
      fail: reject,
      success(response) {
        if (response.statusCode !== 200 || !response.data?.byteLength || response.data.byteLength > 5 * 1024 * 1024) {
          reject(new Error('INVALID_SHARE_IMAGE')); return;
        }
        const bytes = new Uint8Array(response.data);
        const extension = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? '.jpg'
          : bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? '.png'
          : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? '.webp' : '';
        if (!extension) { reject(new Error('INVALID_SHARE_IMAGE_FORMAT')); return; }
        filePath = fileBase + extension;
        fs.writeFile({ filePath, data: response.data, fail(error) { release(); reject(error); }, success() {
          resolve({ path: filePath, release });
        } });
      },
    });
  });
}
