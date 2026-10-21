"use client";

import { type FormEvent, useState } from "react";

type AccountProfile = {
  birthYear: number | null;
  countryCode: string | null;
  email: string | null;
  gender: string | null;
  marketingGranted: boolean;
  name: string;
  personalizationGranted: boolean;
  phone: string | null;
  preferredLocale: string | null;
  updatedAt: Date | string;
};

type StatusTone = "idle" | "success" | "error";

export function ProfileForm({ initialProfile }: { initialProfile: AccountProfile }) {
  const [profile, setProfile] = useState({
    birthYear: initialProfile.birthYear ? String(initialProfile.birthYear) : "",
    countryCode: initialProfile.countryCode ?? "CN",
    email: initialProfile.email ?? "",
    gender: initialProfile.gender ?? "",
    marketingGranted: initialProfile.marketingGranted,
    name: initialProfile.name,
    personalizationGranted: initialProfile.personalizationGranted,
    phone: initialProfile.phone ?? "",
    preferredLocale: initialProfile.preferredLocale ?? "zh-CN",
  });
  const [message, setMessage] = useState("可修改昵称、手机号和邮箱。手机号会用于登录和订单联系。");
  const [tone, setTone] = useState<StatusTone>("idle");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setTone("idle");
    setMessage("正在保存个人资料...");

    const response = await fetch("/api/account/profile", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...profile,
        birthYear: profile.birthYear ? Number(profile.birthYear) : null,
        countryCode: profile.countryCode ? profile.countryCode.toUpperCase() : null,
        gender: profile.gender || null,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      profile?: AccountProfile;
    };
    setSubmitting(false);

    if (!response.ok || !result.ok || !result.profile) {
      setTone("error");
      setMessage(formatProfileError(result.error));
      return;
    }

    setProfile({
      birthYear: result.profile.birthYear ? String(result.profile.birthYear) : "",
      countryCode: result.profile.countryCode ?? "CN",
      email: result.profile.email ?? "",
      gender: result.profile.gender ?? "",
      marketingGranted: result.profile.marketingGranted,
      name: result.profile.name,
      personalizationGranted: result.profile.personalizationGranted,
      phone: result.profile.phone ?? "",
      preferredLocale: result.profile.preferredLocale ?? "zh-CN",
    });
    setTone("success");
    setMessage("个人资料已保存。手机号变更后，后续页面会按新资料展示。");
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div>
        <h2 className="text-xl font-black">个人资料</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-muted">这些信息用于订单联系、售后处理和账户识别。</p>
      </div>
      <label className="vk-field">
        昵称
        <input
          autoComplete="name"
          disabled={submitting}
          maxLength={40}
          onChange={(event) => setProfile((value) => ({ ...value, name: event.target.value }))}
          placeholder="请输入昵称"
          required
          value={profile.name}
        />
      </label>
      <label className="vk-field">
        手机号
        <input
          autoComplete="tel"
          disabled={submitting}
          inputMode="tel"
          onChange={(event) => setProfile((value) => ({ ...value, phone: event.target.value }))}
          placeholder="请输入大陆手机号"
          required
          value={profile.phone}
        />
      </label>
      <label className="vk-field">
        邮箱
        <input
          autoComplete="email"
          disabled={submitting}
          onChange={(event) => setProfile((value) => ({ ...value, email: event.target.value }))}
          placeholder="可选，用于客服回访"
          type="email"
          value={profile.email}
        />
      </label>
      <details className="border-y border-line py-4">
        <summary className="cursor-pointer text-sm">选填资料与订阅偏好</summary><div className="mt-4 grid gap-4">
        <div>
        <p className="mt-1 text-xs font-bold leading-5 text-muted">用于尺码、内容与服务分析；不填写也不影响购买。只有在下方同意个性化后才用于客户画像。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="vk-field">出生年份<input disabled={submitting} inputMode="numeric" max={new Date().getFullYear() - 13} min="1900" onChange={(event) => setProfile((value) => ({ ...value, birthYear: event.target.value }))} placeholder="例如 1995" type="number" value={profile.birthYear} /></label>
        <label className="vk-field">性别<select disabled={submitting} onChange={(event) => setProfile((value) => ({ ...value, gender: event.target.value }))} value={profile.gender}><option value="">不填写</option><option value="MALE">男</option><option value="FEMALE">女</option><option value="NON_BINARY">非二元</option><option value="PREFER_NOT_TO_SAY">不愿透露</option></select></label>
        <label className="vk-field">国家/地区代码<input disabled={submitting} maxLength={2} onChange={(event) => setProfile((value) => ({ ...value, countryCode: event.target.value }))} placeholder="CN" value={profile.countryCode} /></label>
        <label className="vk-field">偏好语言<select disabled={submitting} onChange={(event) => setProfile((value) => ({ ...value, preferredLocale: event.target.value }))} value={profile.preferredLocale}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
      </div>
      <label className="flex items-start gap-3 rounded-[8px] bg-soft px-4 py-3 text-sm font-bold"><input checked={profile.personalizationGranted} disabled={submitting} onChange={(event) => setProfile((value) => ({ ...value, personalizationGranted: event.target.checked }))} type="checkbox" /><span>同意将选填资料与购买、浏览偏好结合，用于个性化服务和客户画像。</span></label>
      <p className="text-xs font-bold leading-5 text-muted">拒绝可选信息不会影响浏览、下单或售后；你可以随时撤回同意。</p>
      <label className="flex items-start gap-3 rounded-[8px] bg-soft px-4 py-3 text-sm font-bold"><input checked={profile.marketingGranted} disabled={submitting} onChange={(event) => setProfile((value) => ({ ...value, marketingGranted: event.target.checked }))} type="checkbox" /><span>同意接收新品与活动信息；可随时取消。</span></label>
      </div></details>
      <button className="vk-button vk-button-dark w-max" disabled={submitting} type="submit">
        {submitting ? "保存中..." : "保存个人资料"}
      </button>
      <p className={statusClass(tone)} role="status">{message}</p>
    </form>
  );
}

function formatProfileError(error: string | undefined) {
  const messages: Record<string, string> = {
    ACCOUNT_EMAIL_IN_USE: "这个邮箱已被其他账户使用。",
    ACCOUNT_PHONE_IN_USE: "这个手机号已被其他账户使用。",
    AUTH_REQUIRED: "请先登录。",
    INVALID_ACCOUNT_PROFILE: "请填写昵称、正确手机号和有效邮箱。",
    INVALID_PHONE: "请输入正确的大陆手机号。",
  };
  return error ? messages[error] ?? error : "个人资料保存失败。";
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#067647]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]";
  return "rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted";
}
