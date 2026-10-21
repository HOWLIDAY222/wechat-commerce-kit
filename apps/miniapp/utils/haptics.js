const FEEDBACK_INTERVAL = 180;
let lastFeedbackAt = -Infinity;
const recentFeedback = [];

function pulse(method, strength, onResult) {
  const record = { at: Date.now(), method, strength: strength || '', status: 'requested', message: '' };
  let finished = false, timer;
  const finish = (status, error) => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    record.status = status;
    record.message = String(error?.errMsg || error?.message || '').slice(0, 240);
    if (onResult) { try { onResult({ ...record }); } catch {} }
  };
  try {
    const now = record.at;
    if (now >= lastFeedbackAt && now - lastFeedbackAt < FEEDBACK_INTERVAL) { finish('throttled'); return false; }
    recentFeedback.push(record);
    if (recentFeedback.length > 8) recentFeedback.shift();
    if (typeof wx === 'undefined' || typeof wx[method] !== 'function') { finish('unsupported'); return false; }
    lastFeedbackAt = now;
    if (onResult) timer = setTimeout(() => finish('timeout'), 2000);
    const pending = wx[method]({ ...(strength ? { type: strength } : {}), success: () => finish('accepted'), fail: error => finish('failed', error) });
    if (pending && typeof pending.then === 'function') pending.then(() => finish('accepted'), error => finish('failed', error));
    return true;
  } catch (error) {
    finish('failed', error);
    return false;
  }
}

// Optional device feedback must never interrupt a user action.
export function tapFeedback() {
  return pulse('vibrateShort', 'heavy');
}

export function testFeedback(kind, onResult) { return pulse(kind === 'long' ? 'vibrateLong' : 'vibrateShort', kind === 'long' ? '' : 'heavy', onResult); }
export function feedbackDiagnostics() { return recentFeedback.map(record => ({ ...record })); }
