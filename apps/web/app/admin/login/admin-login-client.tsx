"use client";

import { type FormEvent, useEffect, useState } from "react";
import { HumanChallengeField, useHumanChallenge } from "@/components/auth/human-challenge-field";

type StatusTone = "idle" | "success" | "error";
type LoginMode = "password" | "sms";

type AdminLoginClientProps = {
  allowLocalMockLogin: boolean;
};

export function AdminLoginClient({ allowLocalMockLogin }: AdminLoginClientProps) {
  const [devCode, setDevCode] = useState<string | null>(null);
  const [mode, setMode] = useState<LoginMode>("password");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("可用管理员手机号 + 验证码登录，也可用管理员手机号 + 密码登录。");
  const [tone, setTone] = useState<StatusTone>("idle");
  const [submitting, setSubmitting] = useState<"send" | "verify" | "password" | "local" | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);
  const smsHuman = useHumanChallenge("admin_sms");
  const passwordHuman = useHumanChallenge("admin_password");

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
      setMessage("请先输入管理员手机号。");
      return;
    }

    setPhone(nextPhone);
    setSubmitting("send");
    setTone("idle");
    setMessage("正在校验并发送验证码...");

    const response = await fetch("/api/auth/admin/sms/send", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        humanAnswer: String(form.get("humanAnswer") ?? ""),
        humanChallengeId: String(form.get("humanChallengeId") ?? ""),
        phone: nextPhone,
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
      setMessage(formatAdminAuthError(result.error, "管理员验证码发送失败。", nextRetryAfter));
      return;
    }

    setRetryAfter(60);
    setDevCode(result.devCode ?? null);
    setTone("success");
    setMessage(result.devCode ? `本地验证码：${result.devCode}` : `如果该手机号已授权，验证码会发送至 ${result.phone ?? "管理员手机"}。`);
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPhone = String(form.get("phone") ?? phone).trim();
    const code = String(form.get("code") ?? "").trim();
    if (!nextPhone || !code) {
      setTone("error");
      setMessage("请填写管理员手机号和 6 位验证码。");
      return;
    }

    setSubmitting("verify");
    setTone("idle");
    setMessage("正在创建后台会话...");

    const response = await fetch("/api/auth/admin/sms/verify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: nextPhone, code }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSubmitting(null);
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatAdminAuthError(result.error, "后台登录失败。"));
      return;
    }

    setTone("success");
    setMessage("后台登录成功，正在进入管理后台。");
    window.location.assign(getSafeAdminReturnTo());
  }

  async function passwordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPhone = String(form.get("phone") ?? phone).trim();
    const password = String(form.get("password") ?? "");
    if (!nextPhone || !password) {
      setTone("error");
      setMessage("请填写管理员手机号和密码。");
      return;
    }

    setPhone(nextPhone);
    setSubmitting("password");
    setTone("idle");
    setMessage("正在校验管理员密码...");

    const response = await fetch("/api/auth/admin/password/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        humanAnswer: String(form.get("humanAnswer") ?? ""),
        humanChallengeId: String(form.get("humanChallengeId") ?? ""),
        password,
        phone: nextPhone,
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
      setMessage(formatAdminAuthError(result.error, "后台密码登录失败。", normalizeRetryAfter(result.retryAfterSeconds)));
      return;
    }

    setTone("success");
    setMessage("后台登录成功，正在进入管理后台。");
    window.location.assign(getSafeAdminReturnTo());
  }

  async function localMockLogin() {
    setSubmitting("local");
    setTone("idle");
    setMessage("正在创建本地管理员会话...");
    const response = await fetch("/api/auth/admin/mock-login", {
      method: "POST",
      credentials: "same-origin",
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSubmitting(null);
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatAdminAuthError(result.error, "本地管理员登录失败。"));
      return;
    }
    setTone("success");
    setMessage("后台登录成功，正在进入管理后台。");
    window.location.assign(getSafeAdminReturnTo());
  }

  return (
    <div className="grid gap-5">
      <div aria-label="登录方式" className="grid grid-cols-2 bg-[#f2f4f7] p-1" role="group">
        <button
          aria-pressed={mode === "password"}
          className={`min-h-11 px-4 text-sm font-semibold transition ${mode === "password" ? "bg-white text-[#101828] shadow-sm" : "text-[#667085] hover:text-[#101828]"}`}
          onClick={() => setMode("password")}
          type="button"
        >
          密码登录
        </button>
        <button
          aria-pressed={mode === "sms"}
          className={`min-h-11 px-4 text-sm font-semibold transition ${mode === "sms" ? "bg-white text-[#101828] shadow-sm" : "text-[#667085] hover:text-[#101828]"}`}
          onClick={() => setMode("sms")}
          type="button"
        >
          验证码登录
        </button>
      </div>

      {mode === "password" ? (
        <form className="grid gap-5" onSubmit={passwordLogin}>
          <label className="vk-field">
            管理员手机号
            <input
              autoComplete="tel"
              inputMode="tel"
              name="phone"
              onChange={(event) => setPhone(event.target.value)}
              placeholder="请输入管理员手机号"
              required
              value={phone}
            />
          </label>
          <label className="vk-field">
            密码
            <input autoComplete="current-password" name="password" placeholder="请输入登录密码" required type="password" />
          </label>
          <HumanChallengeField disabled={submitting === "password"} state={passwordHuman} />
          <button className="vk-button vk-button-dark w-full" disabled={submitting === "password" || passwordHuman.loading || !passwordHuman.challenge} type="submit">
            {submitting === "password" ? "登录中..." : "登录后台"}
          </button>
        </form>
      ) : (
        <div className="grid gap-5">
          <form className="grid gap-5" onSubmit={sendCode}>
            <label className="vk-field">
              管理员手机号
              <input
                autoComplete="tel"
                inputMode="tel"
                name="phone"
                onChange={(event) => setPhone(event.target.value)}
                placeholder="请输入管理员手机号"
                required
                value={phone}
              />
            </label>
            <HumanChallengeField disabled={submitting === "send" || retryAfter > 0} state={smsHuman} />
            <button className="vk-button vk-button-light w-full" disabled={submitting === "send" || retryAfter > 0 || smsHuman.loading || !smsHuman.challenge} type="submit">
              {submitting === "send" ? "发送中..." : retryAfter > 0 ? `${retryAfter}s 后可重新获取` : "获取验证码"}
            </button>
          </form>
          <form className="grid gap-5 border-t border-[#e4e7ec] pt-5" onSubmit={verifyCode}>
            <input name="phone" type="hidden" value={phone} />
            <label className="vk-field">
              验证码
              <input autoComplete="one-time-code" inputMode="numeric" name="code" placeholder="6 位验证码" required />
            </label>
            <button className="vk-button vk-button-dark w-full" disabled={submitting === "verify"} type="submit">
              {submitting === "verify" ? "登录中..." : "登录后台"}
            </button>
          </form>
        </div>
      )}
      {allowLocalMockLogin ? (
        <div className="border-t border-[#e4e7ec] pt-5">
          <button className="vk-button vk-button-light w-full" disabled={submitting === "local"} onClick={localMockLogin} type="button">
            {submitting === "local" ? "创建中..." : "本地管理员登录"}
          </button>
        </div>
      ) : null}
      <p className={statusClass(tone)} role="status">
        {message}
      </p>
      {devCode ? <p className="text-xs font-semibold text-[#667085]">本地验证码仅用于开发验证；生产环境会发送真实短信。</p> : null}
    </div>
  );
}

function getSafeAdminReturnTo() {
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  if (returnTo && (returnTo === "/admin" || returnTo.startsWith("/admin/"))) return returnTo;
  return "/admin";
}

function formatAdminAuthError(error: string | undefined, fallback: string, retryAfterSeconds = 0) {
  const messages: Record<string, string> = {
    ADMIN_PASSWORD_LOGIN_FAILED: "手机号或密码不正确。",
    HUMAN_VERIFICATION_EXPIRED: "人机验证已过期，请重新计算。",
    HUMAN_VERIFICATION_INVALID: "人机验证答案不正确，请重新计算。",
    HUMAN_VERIFICATION_REQUIRED: "请先完成人机验证。",
    INVALID_PHONE: "请输入正确的大陆手机号。",
    INVALID_ADMIN_PASSWORD_LOGIN_REQUEST: "请填写正确的管理员手机号和密码。",
    PASSWORD_LENGTH_INVALID: "密码长度需为 8-72 位。",
    PASSWORD_LOGIN_RATE_LIMITED: retryAfterSeconds > 0 ? `密码登录尝试过多，请 ${retryAfterSeconds} 秒后再试。` : "密码登录尝试过多，请稍后再试。",
    SMS_CODE_EXPIRED: "验证码已过期，请重新获取。",
    SMS_CODE_MISMATCH: "验证码不正确，请重新输入。",
    SMS_CODE_NOT_FOUND: "验证码不存在或已失效，请重新获取。",
    SMS_IP_HOURLY_LIMIT: "当前网络发送过于频繁，请稍后再试。",
    SMS_PHONE_DAILY_LIMIT: "该手机号今日发送次数已达上限。",
    SMS_PHONE_HOURLY_LIMIT: "该手机号发送过于频繁，请稍后再试。",
    SMS_SEND_COOLDOWN: retryAfterSeconds > 0 ? `验证码刚刚发送过，还需等待 ${retryAfterSeconds} 秒。` : "验证码刚刚发送过，请稍后再试。",
  };
  if (!error) return fallback;
  if (error.startsWith("ALIYUN_SMS_SEND_FAILED")) return "短信发送失败，请稍后再试或检查阿里云短信配置。";
  return messages[error] ?? fallback;
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-foreground px-4 py-3 text-sm font-black text-background";
  if (tone === "error") return "rounded-[8px] border border-foreground px-4 py-3 text-sm font-black text-foreground";
  return "rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted";
}

function normalizeRetryAfter(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}
