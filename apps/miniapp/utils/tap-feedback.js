import { tapFeedback } from './haptics';

function feedbackForTap(event) {
  const disabled = event?.currentTarget?.dataset?.disabled;
  if (event?.type === 'tap' && ![true, 'true', 1, '1'].includes(disabled)) tapFeedback();
}

// Keep native events, return values and receiver intact. Programmatic method
// calls and non-tap events do not create device feedback.
export function withTapFeedback(definition, handlers, { component = false, tabBar = false } = {}) {
  const output = { ...definition };
  const methods = component ? { ...definition.methods } : output;
  for (const name of handlers) {
    const original = methods[name];
    if (typeof original !== 'function') continue;
    methods[name] = function (...args) {
      feedbackForTap(args[0]);
      return original.apply(this, args);
    };
  }
  methods.feedbackTap = feedbackForTap;
  if (tabBar) {
    const original = methods.onTabItemTap;
    methods.onTabItemTap = function (...args) {
      tapFeedback();
      return typeof original === 'function' ? original.apply(this, args) : undefined;
    };
  }
  if (component) output.methods = methods;
  return output;
}
