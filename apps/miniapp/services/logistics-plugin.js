let pendingLoad = null;

export function isLogisticsSimulator() {
  try {
    const info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo()
      : typeof wx.getSystemInfoSync === 'function' ? wx.getSystemInfoSync() : null;
    return info?.platform === 'devtools';
  } catch { return false; }
}

export function loadLogisticsPlugin() {
  if (isLogisticsSimulator()) return Promise.reject(Error('LOGISTICS_SIMULATOR'));
  if (typeof requirePlugin !== 'function' || typeof requirePlugin.async !== 'function') return Promise.reject(Error('LOGISTICS_UNSUPPORTED'));
  if (pendingLoad) return pendingLoad;
  const loading = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('LOGISTICS_LOAD_TIMEOUT')), 12000);
    Promise.resolve().then(() => requirePlugin.async('logisticsPlugin')).then(plugin => {
      if (typeof plugin?.openWaybillTracking !== 'function') throw Error('LOGISTICS_UNSUPPORTED');
      return plugin;
    }).then(resolve, reject).finally(() => clearTimeout(timeout));
  });
  pendingLoad = loading;
  const release = () => { if (pendingLoad === loading) pendingLoad = null; };
  loading.then(release, release);
  return loading;
}
