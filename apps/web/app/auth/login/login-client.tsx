"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { HumanChallengeField, useHumanChallenge } from "@/components/auth/human-challenge-field";
import { PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";

type StatusTone = "idle" | "success" | "error";
type LoginMode = "code" | "password";

export function LoginClient() {
  const [devCode, setDevCode] = useState<string | null>(null);
  const [mode, setMode] = useState<LoginMode>("code");
  const [phone, setPhone] = useState("");
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [message, setMessage] = useState("输入手机号后即可获取验证码，也可切换为密码登录。");
  const [tone, setTone] = useState<StatusTone>("idle");
  const [submitting, setSubmitting] = useState<"send" | "verify" | "password" | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const smsHuman = useHumanChallenge("customer_sms");
  const passwordHuman = useHumanChallenge("customer_password");

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setTimeout(() => setRetryAfter((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPhone = String(form.get("phone") ?? "").trim();
    if (!nextPhone) {
      setTone("error");
      setMessage("请先输入手机号。");
      return;
    }

    setPhone(nextPhone);
    setSubmitting("send");
    setTone("idle");
    setMessage("正在发送验证码...");

    try {
    const response = await fetch("/api/auth/sms/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crossBorderConsent: true,
        humanAnswer: String(form.get("humanAnswer") ?? ""),
        humanChallengeId: String(form.get("humanChallengeId") ?? ""),
        phone: nextPhone,
        privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION,
        scene: "login",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      devCode?: string;
      error?: string;
      phone?: string;
      retryAfterSeconds?: number;
    };
    setSubmitting(null);
    void smsHuman.refresh();
    if (!response.ok || !result.ok) {
      const nextRetryAfter = normalizeRetryAfter(result.retryAfterSeconds);
      setRetryAfter(nextRetryAfter);
      setTone("error");
      setMessage(formatAuthError(result.error, "验证码发送失败。", nextRetryAfter));
      return;
    }

    setRetryAfter(60);
    setDevCode(result.devCode ?? null);
    setTone("success");
    setMessage(result.devCode ? `本地验证码：${result.devCode}` : `验证码已发送至 ${result.phone ?? "你的手机"}。`);
    } catch {
      setTone("error");
      setMessage("连接失败，请重试。已填写的信息会保留。");
    } finally { setSubmitting(null); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPhone = String(form.get("phone") ?? phone).trim();
    const code = String(form.get("code") ?? "").trim();
    if (!nextPhone || !code) {
      setTone("error");
      setMessage("请填写手机号和 6 位验证码。");
      return;
    }

    setSubmitting("verify");
    setTone("idle");
    setMessage("正在登录...");

    try {
    const response = await fetch("/api/auth/sms/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: nextPhone,
        code,
        crossBorderConsent: true,
        privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION,
        scene: "login",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSubmitting(null);
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatAuthError(result.error, "登录失败。"));
      return;
    }

    handleLoginSuccess();
    } catch {
      setTone("error");
      setMessage("连接失败，请重试。已填写的信息会保留。");
    } finally { setSubmitting(null); }
  }

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPhone = String(form.get("phone") ?? phone).trim();
    const password = String(form.get("password") ?? "");
    if (!nextPhone || !password) {
      setTone("error");
      setMessage("请填写手机号和密码。");
      return;
    }

    setPhone(nextPhone);
    setSubmitting("password");
    setTone("idle");
    setMessage("正在使用密码登录...");

    try {
    const response = await fetch("/api/auth/password/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        crossBorderConsent: true,
        humanAnswer: String(form.get("humanAnswer") ?? ""),
        humanChallengeId: String(form.get("humanChallengeId") ?? ""),
        password,
        phone: nextPhone,
        privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      retryAfterSeconds?: number;
    };
    setSubmitting(null);
    void passwordHuman.refresh();
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatAuthError(result.error, "密码登录失败。", normalizeRetryAfter(result.retryAfterSeconds)));
      return;
    }

    handleLoginSuccess();
    } catch {
      setTone("error");
      setMessage("连接失败，请重试。已填写的信息会保留。");
    } finally { setSubmitting(null); }
  }

  function handleLoginSuccess() {
    const nextPath = normalizeNextPath(new URLSearchParams(window.location.search).get("next"));
    setTone("success");
    setMessage("登录成功，正在跳转...");
    window.setTimeout(() => {
      window.location.replace(nextPath || "/account");
    }, 350);
  }

  return (
    <div className="mt-6 grid gap-5">
      <div className="grid grid-cols-2 rounded-[8px] bg-soft p-1 text-sm font-black">
        <button aria-label="手机号 + 验证码" aria-pressed={mode === "code"} className={`h-10 rounded-[6px] ${mode === "code" ? "bg-white text-brand shadow-sm" : "text-muted"}`} onClick={() => setMode("code")} type="button">
          验证码登录
        </button>
        <button aria-label="手机号 + 密码" aria-pressed={mode === "password"} className={`h-10 rounded-[6px] ${mode === "password" ? "bg-white text-brand shadow-sm" : "text-muted"}`} onClick={() => setMode("password")} type="button">
          密码登录
        </button>
      </div>

      <label className="flex cursor-pointer items-start gap-3 border-y border-line py-4 text-xs font-semibold leading-6 text-black/65">
        <input
          checked={policyAccepted}
          className="mt-1 h-4 w-4 shrink-0 accent-black"
          onChange={(event) => setPolicyAccepted(event.target.checked)}
          type="checkbox"
        />
        <span>
          我已阅读并同意 <Link className="text-black underline underline-offset-4" href="/privacy-policy">《隐私政策》</Link> 和 <Link className="text-black underline underline-offset-4" href="/terms">《服务条款》</Link>，并单独同意为提供账户、订单及售后服务，将必要个人信息传输至浙江阿里巴巴云计算有限公司进行处理。
        </span>
      </label>

      {mode === "password" ? (
        <form className="grid gap-4" onSubmit={passwordLogin}>
          <label className="vk-field">
            手机号
            <input autoComplete="tel" inputMode="tel" name="phone" onChange={(event) => setPhone(event.target.value)} placeholder="请输入手机号" required value={phone} />
          </label>
          <label className="vk-field">
            密码
            <input autoComplete="current-password" name="password" placeholder="用户中心设置的登录密码" required type="password" />
          </label>
          <HumanChallengeField disabled={submitting === "password"} state={passwordHuman} />
          <button className="vk-button vk-button-dark h-12 w-full" disabled={!policyAccepted || submitting === "password" || passwordHuman.loading || !passwordHuman.challenge} type="submit">
            {submitting === "password" ? "登录中..." : "密码登录"}
          </button>
          <p className="text-xs font-bold leading-5 text-muted">没有设置过密码时，请先用验证码登录，然后到账户设置里设置。</p>
        </form>
      ) : (
        <div className="grid gap-4">
          <form className="grid gap-4" onSubmit={sendCode}>
            <label className="vk-field">
              手机号
              <input autoComplete="tel" inputMode="tel" name="phone" onChange={(event) => setPhone(event.target.value)} placeholder="请输入手机号" required value={phone} />
            </label>
            <HumanChallengeField disabled={submitting === "send" || retryAfter > 0} state={smsHuman} />
            <button className="vk-button vk-button-light h-12 w-full" disabled={!policyAccepted || submitting === "send" || retryAfter > 0 || smsHuman.loading || !smsHuman.challenge} type="submit">
              {submitting === "send" ? "发送中..." : retryAfter > 0 ? `${retryAfter}s 后重试` : "获取验证码"}
            </button>
          </form>
          <form className="grid gap-4" onSubmit={verifyCode}>
            <input name="phone" type="hidden" value={phone} />
            <label className="vk-field">
              验证码
              <input autoComplete="one-time-code" inputMode="numeric" name="code" placeholder="6 位验证码" required />
            </label>
            <button className="vk-button vk-button-dark h-12 w-full" disabled={!policyAccepted || submitting === "verify"} type="submit">
              {submitting === "verify" ? "登录中..." : "登录 / 注册"}
            </button>
          </form>
        </div>
      )}

      <p className={statusClass(tone)} role="status">{message}</p>
      {devCode ? <p className="text-xs font-bold text-muted">本地预览验证码已显示；生产环境会发送真实短信。</p> : null}
    </div>
  );
}

function formatAuthError(error: string | undefined, fallback: string, retryAfterSeconds = 0) {
  const messages: Record<string, string> = {
    HUMAN_VERIFICATION_EXPIRED: "人机验证已过期，请重新计算。",
    HUMAN_VERIFICATION_INVALID: "人机验证答案不正确，请重新计算。",
    HUMAN_VERIFICATION_REQUIRED: "请先完成人机验证。",
    INVALID_PHONE: "请输入正确的大陆手机号。",
    INVALID_PASSWORD_LOGIN_REQUEST: "请填写正确的手机号和密码。",
    PASSWORD_LENGTH_INVALID: "密码长度需为 8-72 位。",
    PASSWORD_LOGIN_FAILED: "手机号或密码不正确。",
    PASSWORD_LOGIN_RATE_LIMITED: retryAfterSeconds > 0 ? `密码登录尝试过多，请 ${retryAfterSeconds} 秒后再试。` : "密码登录尝试过多，请稍后再试。",
    PASSWORD_NOT_SET: "该手机号尚未设置登录密码，请先用验证码登录后到账户设置里设置。",
    PRIVACY_CONSENT_REQUIRED: "请先阅读并同意隐私政策及必要信息处理说明。",
    SMS_CODE_EXPIRED: "验证码已过期，请重新获取。",
    SMS_CODE_MISMATCH: "验证码不正确，请重新输入。",
    SMS_CODE_NOT_FOUND: "验证码不存在或已失效，请重新获取。",
    SMS_IP_HOURLY_LIMIT: "当前网络发送过于频繁，请稍后再试。",
    SMS_PHONE_DAILY_LIMIT: "该手机号今日发送次数已达上限。",
    SMS_PHONE_HOURLY_LIMIT: "该手机号发送过于频繁，请稍后再试。",
    SMS_SEND_COOLDOWN: retryAfterSeconds > 0 ? `验证码刚刚发送过，还需等待 ${retryAfterSeconds} 秒。` : "验证码刚刚发送过，请稍后再试。",
  };
  if (!error) return fallback;
  if (error.startsWith("ALIYUN_SMS_SEND_FAILED")) return "短信发送失败，请稍后再试或联系客服。";
  return messages[error] ?? error;
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#067647]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]";
  return "rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted";
}

function normalizeRetryAfter(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function normalizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "";
  return value;
}
