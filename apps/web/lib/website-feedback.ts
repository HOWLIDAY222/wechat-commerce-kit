import { z } from "zod";
export const FEEDBACK_PREFIX = "[WEBSITE_FEEDBACK]\n";
export const FEEDBACK_VERSION = "20260916-website-feedback-v1";
export const purposes = [
  ["company", "了解公司", "Learn about the company"], ["products", "了解品牌 / 产品", "Explore the brand / products"],
  ["careers", "查找招聘信息", "Find career information"], ["partnership", "了解合作机会", "Explore partnerships"],
  ["contact", "联系我们", "Contact us"], ["news", "查看新闻 / 动态", "Read news / updates"], ["other", "其他", "Other"],
] as const;
export const blockers = [
  ["information", "找不到需要的信息", "Could not find the information"], ["navigation", "导航不清楚", "Unclear navigation"],
  ["content", "页面内容难以理解", "Content was difficult to understand"], ["speed", "页面加载较慢", "Slow loading"],
  ["display", "页面显示异常", "Display problems"], ["function", "某个功能无法使用", "A feature did not work"],
  ["mobile", "移动端体验不好", "Poor mobile experience"], ["other", "其他", "Other"],
] as const;
export const improvements = [
  ["design", "页面设计", "Page design"], ["navigation", "导航结构", "Navigation"], ["completeness", "内容完整度", "Content completeness"],
  ["clarity", "信息表达", "Clarity of information"], ["speed", "加载速度", "Loading speed"], ["mobile", "手机端体验", "Mobile experience"],
  ["search", "搜索功能", "Search"], ["accessibility", "无障碍体验", "Accessibility"], ["other", "其他", "Other"],
] as const;
export function feedbackPagePath(value: string): string {
  try { const url = new URL(value, "https://example.invalid");
    if (!["example.invalid", "example.invalid"].includes(url.hostname) || !["https:", "http:"].includes(url.protocol)) return "";
    return url.pathname.slice(0, 500);
  } catch { return ""; }
}
const choices = (options: ReadonlyArray<readonly [string, string, string]>, max: number) => z.array(z.string().refine(v => options.some(o => o[0] === v))).max(max).transform(v => [...new Set(v)]);
export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5), purpose: z.string().refine(v => purposes.some(o => o[0] === v)),
  completion: z.enum(["yes", "partly", "no"]), blockers: choices(blockers, 8).default([]), improvements: choices(improvements, 9).default([]),
  suggestion: z.string().trim().max(2000).default(""), clarity: z.enum(["clear", "partly", "unclear", ""]).default(""),
  page: z.string().trim().max(1000).refine(v => !v || Boolean(feedbackPagePath(v))), contact: z.string().trim().max(120).default(""),
  locale: z.enum(["zh", "en"]), viewport: z.object({ width: z.number().int().min(1).max(20000), height: z.number().int().min(1).max(20000) }).optional(),
  version: z.string().max(80).default(FEEDBACK_VERSION), website: z.literal("").optional(),
}).refine(v => v.completion !== "no" || v.blockers.length > 0, { path: ["blockers"], message: "Select a reason" });
export type Feedback = z.infer<typeof feedbackSchema>;
export type StoredFeedback = Feedback & { device: string; os: string; browser: string };
export function feedbackContext(page: string) { return /^(\/en)?\/careers(?:\/|$)/.test(page) ? "careers" : /^(\/en)?\/(products|shop)(?:\/|$)/.test(page) ? "products" : ""; }
export function deviceInfo(ua: string) {
  const tablet = /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));
  const device = tablet ? "平板 / Tablet" : /Mobile|iPhone|iPod/i.test(ua) ? "手机 / Mobile" : "PC";
  const os = /iPad|iPhone|iPod/i.test(ua) || (tablet && /Macintosh/i.test(ua)) ? "iOS / iPadOS" : /Android/i.test(ua) ? "Android" : /Windows/i.test(ua) ? "Windows" : /Macintosh/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Unknown";
  const browser = /Edg|EdgiOS/i.test(ua) ? "Edge" : /Firefox|FxiOS/i.test(ua) ? "Firefox" : /Chrome|CriOS/i.test(ua) ? "Chrome" : /Safari/i.test(ua) ? "Safari" : "Other";
  return { device, os, browser };
}
export function feedbackMessage(input: Feedback, ua: string) { return FEEDBACK_PREFIX + JSON.stringify({ ...input, page: input.page ? feedbackPagePath(input.page) : "", blockers: input.completion === "no" ? input.blockers : [], ...deviceInfo(ua) }); }
export function readFeedback(message: string): StoredFeedback | null {
  if (!message.startsWith(FEEDBACK_PREFIX)) return null;
  try { const value = JSON.parse(message.slice(FEEDBACK_PREFIX.length)); const parsed = feedbackSchema.safeParse(value); return parsed.success ? { ...parsed.data, device: String(value.device || "Unknown"), os: String(value.os || "Unknown"), browser: String(value.browser || "Unknown") } : null; } catch { return null; }
}
export function feedbackDisplay(message: string) {
  const f = readFeedback(message); if (!f) return message;
  const label = (options: ReadonlyArray<readonly [string, string, string]>, id: string) => options.find(o => o[0] === id)?.[1] || id;
  return [`整体满意度：${f.rating} / 5`, `访问目的：${label(purposes, f.purpose)}`, `目的完成情况：${{ yes: "是，很顺利", partly: "基本完成", no: "没有完成" }[f.completion]}`,
    f.blockers.length ? `影响体验：${f.blockers.map(v => label(blockers, v)).join("、")}` : "", `改进方向：${f.improvements.map(v => label(improvements, v)).join("、") || "未选择"}`,
    f.clarity ? `${feedbackContext(f.page) === "careers" ? "招聘信息易查找程度" : "产品信息清晰度"}：${{ clear: "清楚 / 容易", partly: "一般", unclear: "不清楚 / 不容易" }[f.clarity]}` : "",
    `最希望改善：${f.suggestion || "未填写"}`, `来源页面：${f.page || "未指定"}`, `${f.device} · ${f.os} · ${f.browser}`,
    `视口：${f.viewport ? `${f.viewport.width}×${f.viewport.height}` : "未提供"} · ${f.locale === "en" ? "英文站" : "中文站"}`, `页面版本：${f.version}`].filter(Boolean).join("\n");
}
