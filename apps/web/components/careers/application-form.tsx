"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, LoaderCircle, Upload } from "lucide-react";
import styles from "./careers.module.css";

export function ApplicationForm({ english, selectedRole, options }: { english: boolean; selectedRole: string; options: { id: string; label: string }[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const key = useRef("");
  const [resumeName, setResumeName] = useState("");
  const [imageNames, setImageNames] = useState<string[]>([]);
  const words = (zh: string, en: string) => english ? en : zh;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget; const data = new FormData(form);
    const resume = data.get("resume");
    if (resume instanceof File && resume.size > 20 * 1024 * 1024) { setMessage(words("附件请控制在 20 MB 以内。", "Keep the attachment under 20 MB.")); return; }
    const images = data.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
    if (images.length > 5 || images.some(image => image.size > 10 * 1024 * 1024)) { setMessage(words("图片最多 5 张，每张最大 10 MB。", "Up to 5 images, 10 MB each.")); return; }
    key.current ||= crypto.randomUUID(); data.set("id", key.current); data.set("locale", english ? "en" : "zh");
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/careers/applications", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        const errors: Record<string, string> = {
          RATE_LIMIT: words("提交较频繁，请一小时后重试，或通过 hr 邮箱联系。", "Please retry in an hour or contact our HR email."),
          INVALID_PDF: words("请上传有效的 PDF 文件，最大 20 MB。", "Upload a valid PDF file, up to 20 MB."),
          INVALID_IMAGE: words("请上传 JPG、PNG 或 WebP 静态图片，单张最大 10 MB。", "Upload a JPG, PNG or WebP still image, up to 10 MB each."),
          TOO_MANY_IMAGES: words("一次最多上传 5 张图片。", "Upload up to 5 images at a time."),
          WORK_REQUIRED: words("该方向请提供作品集链接，或上传作品 PDF / 图片。", "For this area, include a portfolio link or upload your work as a PDF or images."),
          INVALID_APPLICATION: words("请检查必填项，并同意资料使用说明。", "Check the required fields and consent to the information notice."),
          BODY_TOO_LARGE: words("附件过大：PDF 最大 20 MB，图片单张最大 10 MB，最多 5 张。", "PDF: up to 20 MB; up to 5 images, 10 MB each."),
        };
        throw new Error(errors[result.error] || words("暂时无法提交，请稍后重试或发送至 hr@example.invalid。", "We could not save your introduction. Retry later or write to hr@example.invalid."));
      }
      setDone(true); setMessage(words(`自荐资料已提交。回执编号：${result.id}。当前为人才储备，有匹配需求时再联系沟通。`, `Your introduction has been received. Reference: ${result.id}. This is a talent pool; we may contact you when a suitable need arises.`)); form.reset(); setResumeName(""); setImageNames([]);
    } catch (error) { setMessage(error instanceof Error ? error.message : words("提交失败，请重试。", "Submission failed. Please retry.")); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit} aria-busy={busy}>
    <label className={styles.field}>{words("姓名 *", "Name *")}<input autoComplete="name" name="name" required maxLength={80} disabled={done || busy} /></label>
    <label className={styles.field}>{words("联系邮箱或手机 *", "Email or phone *")}<input name="contact" required minLength={5} maxLength={120} disabled={done || busy} /></label>
    <label className={`${styles.field} ${styles.full}`}>{words("自荐方向 *", "Area of interest *")}<select defaultValue={options.some(item => item.id === selectedRole) ? selectedRole : ""} name="role" required disabled={done || busy}><option value="" disabled>{words("请选择方向", "Choose an area")}</option>{options.map(role => <option value={role.id} key={role.id}>{role.label}</option>)}</select></label>
    <label className={`${styles.field} ${styles.full}`}>{words("个人简介 *", "Tell us about yourself *")}<textarea name="intro" required minLength={20} maxLength={2000} rows={4} placeholder={words("介绍你的经历、擅长的事情，以及希望参与的工作（至少 20 字）。", "Your experience, strengths and the work you would like to contribute to (at least 20 characters).")} disabled={done || busy} /></label>
    <label className={`${styles.field} ${styles.full}`}>{words("简历 / 作品集附件", "CV / Portfolio attachment")}<span className={styles.upload}><Upload aria-hidden="true" size={24} strokeWidth={1.4} /><span>{words("选择 PDF 文件", "Choose a PDF")}</span><span className={styles.fileNames}>{resumeName || words("PDF · 最大 20 MB", "PDF · Up to 20 MB")}</span><input aria-label={words("选择简历或作品 PDF", "Choose CV or portfolio PDF")} name="resume" type="file" accept="application/pdf,.pdf" disabled={done || busy} onChange={event => { setResumeName(event.target.files?.[0]?.name || ""); setMessage(""); }} /></span><small>{words("PDF 格式，最大 20 MB。品牌、设计、摄影、内容方向请提供作品 PDF、图片或下方链接。", "PDF, up to 20 MB. For brand, design, photography and content, include a work PDF, images or a link below.")}</small></label>
    <label className={`${styles.field} ${styles.full}`}>{words("作品图片", "Portfolio images")}<span className={styles.upload}><Upload aria-hidden="true" size={24} strokeWidth={1.4} /><span>{words("选择作品图片", "Choose images")}</span><span className={styles.fileNames}>{imageNames.length ? imageNames.join(" · ") : words("最多 5 张 · 单张最大 10 MB", "Up to 5 images · 10 MB each")}</span><input aria-label={words("选择作品图片", "Choose portfolio images")} name="images" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" multiple disabled={done || busy} onChange={event => { setImageNames(Array.from(event.target.files || []).map(file => file.name)); setMessage(""); }} /></span><small>{words("JPG、PNG、WebP 静态图片，单张最大 10 MB，每次最多 5 张。更多作品可通过作品集链接提供。", "JPG, PNG or WebP still images. Up to 5 images, 10 MB each. Use a portfolio link for more work.")}</small></label>
    <label className={`${styles.field} ${styles.full}`}>{words("作品集链接", "Portfolio link")}<input name="portfolio" type="url" maxLength={1000} placeholder="https://" disabled={done || busy} /></label>
    <label className={`${styles.field} ${styles.full}`}>{words("可开始时间 / 时间安排 *", "Availability *")}<input name="availability" required maxLength={200} placeholder={words("例如：两周后可开始，每周可参与三天", "For example: available in two weeks, three days per week")} disabled={done || busy} /></label>
    <div className={styles.hidden} aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
    <label className={`${styles.consent} ${styles.full}`}><input type="checkbox" name="consent" value="yes" required disabled={done || busy} /><span>{words("我同意 MerchantKit 为人才储备评估与后续联系保存和使用本次提交的资料。", "I agree to MerchantKit storing and using this information to consider my talent introduction and contact me about relevant opportunities.")}</span></label>
    <p className={`${styles.privacy} ${styles.full}`}>{words("资料仅供授权负责人查看。请勿提供身份证件、银行卡等无关敏感资料。可通过 hr@example.invalid 申请撤回或删除。", "Only authorized personnel can access your submission. Do not include identity or banking documents. To withdraw or request deletion, contact hr@example.invalid.")} <Link href={english ? "/en/privacy-policy" : "/privacy-policy"}>{words("隐私政策", "Privacy information")}</Link></p>
    <button className={`${styles.submit} ${styles.full}`} type="submit" disabled={busy || done}><span>{busy ? words("正在提交…", "Submitting…") : done ? words("已收到自荐", "Introduction received") : words("提交人才储备自荐", "Submit your introduction")}</span>{busy ? <LoaderCircle className="vk-spinner-icon" aria-hidden="true" size={18} /> : done ? <Check aria-hidden="true" size={18} /> : <ArrowUpRight aria-hidden="true" size={18} />}</button>
    {message && <p className={`${styles.message} ${styles.full}`} role={done ? "status" : "alert"} aria-live="polite">{done && <Check aria-hidden="true" size={22} />}<span>{message}</span></p>}
  </form>;
}
