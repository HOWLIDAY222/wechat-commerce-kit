"use client";

import { type FormEvent, useState } from "react";

type Status = {
  tone: "idle" | "success" | "error";
  message: string;
};

export function ContactInquiryForm() {
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: "请留下有效联系方式，客服会按提交顺序跟进。",
  });
  const [submitting, setSubmitting] = useState(false);

  async function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmitting(true);
    setStatus({ tone: "idle", message: "正在提交咨询..." });

    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        contact: String(form.get("contact") ?? ""),
        message: String(form.get("message") ?? ""),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; inquiryId?: string };
    setSubmitting(false);

    if (!response.ok || !result.ok) {
      setStatus({ tone: "error", message: result.error === "INVALID_CONTACT_REQUEST" ? "请填写姓名、联系方式和至少 5 个字的咨询内容。" : "咨询提交失败，请稍后重试。" });
      return;
    }

    formElement.reset();
    const reference = result.inquiryId ? `（编号 ${result.inquiryId.slice(-8).toUpperCase()}）` : "";
    setStatus({ tone: "success", message: `咨询已提交${reference}，客服会按你留下的联系方式跟进。` });
  }

  return (
    <form className="mt-5 grid gap-5 md:grid-cols-2" onSubmit={submitInquiry}>
      <label className="vk-field">
        姓名
        <input disabled={submitting} name="name" placeholder="你的姓名" required />
      </label>
      <label className="vk-field">
        联系方式
        <input disabled={submitting} name="contact" placeholder="手机号或邮箱" required />
      </label>
      <label className="vk-field md:col-span-2">
        内容
        <textarea disabled={submitting} minLength={5} name="message" placeholder="请描述商品、配送或售后问题" required />
      </label>
      <button className="vk-button vk-button-dark w-max" disabled={submitting} type="submit">
        {submitting ? "提交中..." : "提交咨询"}
      </button>
      <p className={statusClass(status.tone)} role="status">{status.message}</p>
    </form>
  );
}

function statusClass(tone: Status["tone"]) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#027a48] md:col-span-2";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318] md:col-span-2";
  return "rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted md:col-span-2";
}
