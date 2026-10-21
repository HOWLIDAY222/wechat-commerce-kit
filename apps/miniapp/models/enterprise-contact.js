// Plugin completion reports contact-card delivery, never a verified friendship.
export function contactResult(detail) {
  const code = detail && typeof detail === 'object' && Number.isInteger(detail.errcode) ? detail.errcode : null;
  if (code === 0 || code === -3006) {
    return {
      message: detail.notifytype === 1 ? '请识别微信展示的二维码，完成添加或联系顾问。' : '请按微信提示完成添加或联系顾问。',
      isError: false,
    };
  }
  const messages = {
    '-3002': '顾问信息暂时无法读取，请稍后重试。',
    '-3004': '这次未完成授权，你可以稍后再联系顾问。',
    '-3005': '暂时未能提供联系方式，请稍后重试。',
    '-3008': '顾问暂时无法接待，请稍后重试。',
  };
  return { message: messages[code] || '暂时无法确认联系结果，请稍后重试。', isError: true };
}
