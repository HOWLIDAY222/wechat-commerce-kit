export function currentMiniappVisit(app = getApp()) { return Number(app?.globalData?.miniappVisitId) || 0; }
export function beginMiniappVisit(app = getApp()) {
  if (!app) return;
  if (!app.globalData) app.globalData = {};
  app.globalData.miniappVisitId = currentMiniappVisit(app) + 1;
}
