export function readStorage(key, fallback = null) {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value === undefined || value === null ? fallback : value;
  } catch (_error) {
    return fallback;
  }
}

export function writeStorage(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (_error) {
    return false;
  }
}

export function removeStorage(key) {
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (_error) {
    return false;
  }
}
