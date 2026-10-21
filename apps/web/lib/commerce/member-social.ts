import { z } from "zod";

export const socialPlatforms = [
  { key: "XIAOHONGSHU", label: "小红书" }, { key: "DOUYIN", label: "抖音" },
  { key: "WECHAT_MOMENTS", label: "微信朋友圈" }, { key: "WECHAT_CHANNELS", label: "微信视频号" }, { key: "OTHER", label: "其他社媒" },
] as const;
export const socialTaskKeys = ["XIAOHONGSHU_FOLLOW", "SOCIAL_FIRST_POST", "SOCIAL_POST", "SOCIAL_INTERACTION", "SOCIAL_REPOST"] as const;
export const socialCampaignKeys = ["XIAOHONGSHU_FOLLOW", "SOCIAL_POST", "SOCIAL_INTERACTION", "SOCIAL_REPOST"] as const;
export const socialInteractions = ["LIKE", "COMMENT", "FAVORITE"] as const;
export const defaultXiaohongshuAccount = () => ({ enabled: false, name: "MerchantKit", accountId: "demo-account", profileUrl: "https://www.xiaohongshu.com", qrImageUrl: "/assets/brand/xiaohongshu-profile.jpg" });
const cleanText = (min: number, max: number) => z.string().trim().min(min).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const safeHttps = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && !/[\u0000-\u0020]/.test(value); } catch { return false; } };
export const xiaohongshuAccountSchema = z.object({ enabled: z.boolean(), name: cleanText(1, 80), accountId: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
  profileUrl: z.string().max(500).refine(value => safeHttps(value) && ["xhslink.cn", "xhslink.com", "xiaohongshu.com", "www.xiaohongshu.com"].includes(new URL(value).hostname.toLowerCase())),
  qrImageUrl: z.string().max(500).refine(value => /^\/assets\/brand\/[A-Za-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$/.test(value) || /^\/uploads\/[A-Za-z0-9_./-]+$/.test(value) && !value.includes("..") || safeHttps(value)),
}).strict();
export const socialConfigSchema = z.object({ enabled: z.boolean(), instructions: cleanText(2, 1000) }).strict();
export const defaultSocialConfig = () => ({ enabled: false, instructions: "在小红书、抖音、朋友圈等平台完成品牌相关互动、转发或发布真实体验后，提交截图供核验。审核通过后按任务发放积分；同一内容、同一行为及同一截图不重复奖励。请遮盖无关个人信息，点击按钮不会直接发奖。" });

export function validSocialUrl(platform: string, value: string) {
  if (!value) return true;
  if (!safeHttps(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  if (/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (platform === "XIAOHONGSHU") return ["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com", "xhslink.cn"].includes(host);
  if (platform === "DOUYIN") return ["douyin.com", "www.douyin.com", "v.douyin.com", "iesdouyin.com", "www.iesdouyin.com"].includes(host);
  if (platform === "WECHAT_CHANNELS") return ["channels.weixin.qq.com", "weixin.qq.com", "mp.weixin.qq.com"].includes(host);
  return platform === "OTHER" && host.includes(".");
}
export const socialSubmissionSchema = z.object({
  action: z.literal("submit_social_submission"), campaignKey: z.enum(socialCampaignKeys), interactionType: z.enum(socialInteractions).optional(),
  platform: z.enum(["XIAOHONGSHU", "DOUYIN", "WECHAT_MOMENTS", "WECHAT_CHANNELS", "OTHER"]),
  postUrl: z.string().trim().max(1000), note: cleanText(2, 1000), proofKeys: z.array(z.string().regex(/^msu_[a-f0-9]{32}$/)).min(1).max(3),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/), expectedRevision: z.number().int().min(0).max(2_000_000_000).optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.proofKeys).size !== value.proofKeys.length || !validSocialUrl(value.platform, value.postUrl)) context.addIssue({ code: "custom", message: "Invalid social evidence" });
  if (value.campaignKey === "XIAOHONGSHU_FOLLOW" && (value.platform !== "XIAOHONGSHU" || value.proofKeys.length === 0)) context.addIssue({ code: "custom", message: "Follow screenshot required" });
  if (value.platform === "WECHAT_MOMENTS" && (value.proofKeys.length === 0 || value.postUrl !== "")) context.addIssue({ code: "custom", message: "Moments screenshot required" });
  if (!value.postUrl && value.proofKeys.length === 0) context.addIssue({ code: "custom", message: "Evidence required" });
  if (value.campaignKey === "SOCIAL_INTERACTION" ? !value.interactionType : value.interactionType !== undefined) context.addIssue({ code: "custom", message: "Invalid interaction type" });
  if (["SOCIAL_INTERACTION", "SOCIAL_REPOST"].includes(value.campaignKey) && value.proofKeys.length === 0) context.addIssue({ code: "custom", message: "Screenshot required" });
});
export const socialProofUrl = (id: string) => `/api/miniprogram/member-operations/proofs/${encodeURIComponent(id)}`;
export function selectSocialReward(input: { firstEnabled: boolean; postEnabled: boolean; approvedBefore: boolean; firstClaims: number; monthlyClaims: number }) {
  if (!input.approvedBefore && input.firstEnabled && input.firstClaims < 1) return "SOCIAL_FIRST_POST" as const;
  if (input.postEnabled) return "SOCIAL_POST" as const;
  return null;
}
export function canonicalSocialUrl(value: string) {
  if (!value) return "";
  const stable = stableSocialContentUrl(value);
  if (stable) return stable;
  const url = new URL(value); url.hash = "";
  for (const key of Array.from(url.searchParams.keys())) if (/^(?:utm_|xsec_|source$|share_|app_platform$|app_version$|is_from$|xhsshare$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.toString();
}
function stableSocialContentUrl(value: string): string | null {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (["xiaohongshu.com", "www.xiaohongshu.com"].includes(host)) {
      const match = /^\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
      if (match) return "https://www.xiaohongshu.com/explore/" + (/^[a-f0-9]+$/i.test(match[1]) ? match[1].toLowerCase() : match[1]);
    }
    if (["douyin.com", "www.douyin.com"].includes(host)) {
      const match = /^\/(?:video|note)\/([0-9]+)\/?$/.exec(url.pathname);
      if (match) return "https://www.douyin.com/video/" + match[1];
    }
  } catch { /* Missing or unsupported links need a reviewed content reference. */ }
  return null;
}
export function needsManualContentReference(value: string): boolean { return !stableSocialContentUrl(value); }
