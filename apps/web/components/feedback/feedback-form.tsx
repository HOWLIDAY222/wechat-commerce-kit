"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, LoaderCircle, Star } from "lucide-react";
import { purposes, blockers, improvements, feedbackPagePath, feedbackContext, FEEDBACK_VERSION } from "@/lib/website-feedback";
import styles from "./feedback.module.css";
export function FeedbackForm({ english, initialPage }: { english: boolean; initialPage: string }) {
  const [busy, setBusy] = useState(false); const locked = useRef(false);
  const [rating, setRating] = useState(0); const [completion, setCompletion] = useState(""); const [reasons, setReasons] = useState<string[]>([]);
  const [status, setStatus] = useState({ error: false, text: "", id: "" });
  const page = feedbackPagePath(initialPage); const context = feedbackContext(page);
  const l = (zh: string, en: string) => english ? en : zh;
  const satisfaction = english ? ["Very dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very satisfied"] : ["非常不满意", "不满意", "一般", "满意", "非常满意"];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (locked.current) return;
    if (completion === "no" && !reasons.length) { setStatus({ error: true, id: "", text: l("请选择至少一项影响体验的原因。", "Please select at least one reason why you could not complete your visit.") }); return; }
    const form = new FormData(event.currentTarget); locked.current = true; setBusy(true); setStatus({ error: false, text: "", id: "" });
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating, purpose: form.get("purpose"), completion, blockers: completion === "no" ? reasons : [], improvements: form.getAll("improvements"), suggestion: form.get("suggestion"), clarity: form.get("clarity") || "", page, contact: form.get("contact"), website: form.get("website"), locale: english ? "en" : "zh", version: FEEDBACK_VERSION, viewport: { width: window.innerWidth, height: window.innerHeight } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "UNAVAILABLE");
      setStatus({ error: false, text: "", id: result.id });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setStatus({ error: true, id: "", text: code === "RATE_LIMIT" ? l("提交较频繁，请一分钟后再试。", "Too many requests. Please try again in a minute.") : code === "INVALID_FEEDBACK" ? l("请检查必答题和未完成访问目的的原因。", "Please check required questions and reasons for an incomplete visit.") : l("暂时未能提交，你的回答已保留，请稍后重试。", "We could not submit your feedback. Your answers are preserved; please try again.") });
    } finally { locked.current = false; setBusy(false); }
  }
  if (status.id) return <div className={styles.success} role="status"><Check size={32} strokeWidth={1.3} aria-hidden="true" /><h2>{l("感谢你的反馈。", "Thank you for your feedback.")}</h2><p>{l("你的意见将帮助我们持续改善网站体验。", "Your feedback will help us keep improving the website experience.")}</p><Link className={styles.submit} href={page || (english ? "/en" : "/")}>{l("返回网站", "Return to website")}<ArrowUpRight size={18} aria-hidden="true" /></Link></div>;
  return <form className={styles.form} onSubmit={submit} aria-busy={busy}><fieldset className={styles.fields} disabled={busy}>
    <p className={styles.required}>{l("前 3 题必答，其他选填。", "The first 3 questions are required. Everything else is optional.")}</p>
    <fieldset className={styles.question}><legend><span>01</span>{l("你对本网站的整体使用体验满意吗？", "How satisfied are you with your overall website experience?")}</legend><div className={styles.stars}>{satisfaction.map((text, i) => <label key={text} className={rating === i + 1 ? styles.selected : ""}><input required type="radio" name="rating" value={i + 1} checked={rating === i + 1} onChange={() => setRating(i + 1)} /><Star aria-hidden="true" size={28} strokeWidth={1.2} fill={rating >= i + 1 ? "currentColor" : "none"} /><strong>{i + 1}</strong><span>{text}</span></label>)}</div></fieldset>
    <fieldset className={styles.question}><legend><span>02</span>{l("你今天访问网站主要是为了什么？", "What was the main purpose of your visit today?")}</legend><div className={styles.options}>{purposes.map(([id, zh, en]) => <label key={id}><input required name="purpose" type="radio" value={id} />{l(zh, en)}</label>)}</div>{context ? <label className={styles.context}>{context === "careers" ? l("招聘信息是否容易查找？（选填）", "Was career information easy to find? (optional)") : l("产品信息是否足够清晰？（选填）", "Was the product information clear enough? (optional)")}<select name="clarity" defaultValue=""><option value="">{l("请选择", "Select")}</option><option value="clear">{l("是", "Yes")}</option><option value="partly">{l("一般", "Somewhat")}</option><option value="unclear">{l("否", "No")}</option></select></label> : null}</fieldset>
    <fieldset className={styles.question}><legend><span>03</span>{l("你顺利完成了这次访问目的吗？", "Were you able to achieve the purpose of your visit?")}</legend><div className={styles.options}>{[["yes", "是，很顺利", "Yes, easily"], ["partly", "基本完成", "Mostly"], ["no", "没有完成", "No"]].map(([id, zh, en]) => <label key={id}><input name="completion" type="radio" required value={id} checked={completion === id} onChange={() => setCompletion(id)} />{l(zh, en)}</label>)}</div>{completion === "no" ? <fieldset className={styles.followup}><legend>{l("是什么影响了你的体验？（至少选一项）", "What affected your experience? (select at least one)")}</legend><div className={styles.options}>{blockers.map(([id, zh, en]) => <label key={id}><input type="checkbox" name="blockers" value={id} checked={reasons.includes(id)} onChange={e => setReasons(previous => e.target.checked ? [...previous, id] : previous.filter(v => v !== id))} />{l(zh, en)}</label>)}</div></fieldset> : null}</fieldset>
    <fieldset className={styles.question}><legend><span>04</span>{l("你觉得网站哪些方面还可以做得更好？", "Which parts of the website could we improve?")}</legend><p className={styles.hint}>{l("可多选，也可以跳过。", "Select any that apply, or skip.")}</p><div className={styles.options}>{improvements.map(([id, zh, en]) => <label key={id}><input type="checkbox" name="improvements" value={id} />{l(zh, en)}</label>)}</div></fieldset>
    <div className={styles.question}><label htmlFor="feedback-suggestion" className={styles.questionTitle}><span>05</span>{l("如果只能改善一件事，你希望我们改善什么？", "If we could improve just one thing, what should it be?")}</label><textarea id="feedback-suggestion" name="suggestion" maxLength={2000} rows={4} placeholder={l("请告诉我们你的想法……（选填，最多 2000 字）", "Tell us your idea… (optional, up to 2000 characters)")} /></div>
    <label className={styles.contact}>{l("是否愿意留下联系方式？", "Would you like to leave your contact details?")}<p className={styles.hint}>{l("非必填。如果我们需要进一步了解你的反馈，可以与你联系。", "Optional. We may contact you if we need to understand your feedback better.")}</p><input name="contact" maxLength={120} placeholder={l("邮箱 / 手机号", "Email / phone number")} /></label>
    <label className={styles.trap} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <p className={styles.privacy}>{l("提交时会记录来源页面（不含链接参数）、提交时间、设备类型、操作系统、浏览器、屏幕视口、网站语言及页面版本，用于分析和改善体验。请勿填写密码或支付信息。", "On submission, we record the source page (without URL query parameters), time, device type, operating system, browser, viewport, site language and page version to understand and improve your experience. Please do not include passwords or payment details.")} <Link href={english ? "/en/privacy-policy" : "/privacy-policy"} target="_blank">{l("隐私政策", "Privacy Policy")}</Link></p>
    <button type="submit" className={styles.submit}>{busy ? <LoaderCircle className={styles.spinner} size={18} aria-hidden="true" /> : null}{busy ? l("正在提交…", "Submitting…") : l("提交反馈", "Send feedback")}{!busy ? <ArrowUpRight size={18} aria-hidden="true" /> : null}</button>
  </fieldset><p className={status.error ? styles.error : ""} role="status">{status.text}</p></form>;
}
