"use client";

import { type FormEvent, useState } from "react";

type PasswordFormProps = {
  initialHasPassword: boolean;
};

type StatusTone = "idle" | "success" | "error";

export function PasswordForm({ initialHasPassword }: PasswordFormProps) {
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [message, setMessage] = useState(hasPassword ? "已设置登录密码，可在这里修改。" : "尚未设置登录密码，首次设置不需要旧密码。");
  const [tone, setTone] = useState<StatusTone>("idle");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (hasPassword && !currentPassword) {
      setTone("error");
      setMessage("修改已有密码时需要输入当前密码。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setTone("error");
      setMessage("两次输入的新密码不一致。");
      return;
    }
    if (newPassword.length < 8) {
      setTone("error");
      setMessage("新密码至少 8 位。");
      return;
    }

    setSubmitting(true);
    setTone("idle");
    setMessage("正在保存登录密码...");
    const response = await fetch("/api/account/password", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; password?: { hasPassword?: boolean } };
    setSubmitting(false);
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatPasswordError(result.error));
      return;
    }

    setHasPassword(Boolean(result.password?.hasPassword ?? true));
    setTone("success");
    setMessage("登录密码已保存。之后可使用手机号 + 密码登录。");
    formElement.reset();
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div>
        <h2 className="text-xl font-black">账户安全</h2>
        <p className="mt-2 text-sm font-bold leading-6 text-muted">支持验证码登录，也支持手机号 + 密码登录。密码只在这里设置或修改。</p>
      </div>
      {hasPassword ? (
        <label className="vk-field">
          当前密码
          <input autoComplete="current-password" disabled={submitting} name="currentPassword" placeholder="请输入当前密码" required type="password" />
        </label>
      ) : null}
      <label className="vk-field">
        新密码
        <input autoComplete="new-password" disabled={submitting} name="newPassword" placeholder="至少 8 位" required type="password" />
      </label>
      <label className="vk-field">
        确认新密码
        <input autoComplete="new-password" disabled={submitting} name="confirmPassword" placeholder="再次输入新密码" required type="password" />
      </label>
      <button className="vk-button vk-button-dark w-max" disabled={submitting} type="submit">
        {submitting ? "保存中..." : hasPassword ? "修改密码" : "设置密码"}
      </button>
      <p className={statusClass(tone)} role="status">{message}</p>
    </form>
  );
}

function formatPasswordError(error: string | undefined) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "请先登录。",
    CURRENT_PASSWORD_REQUIRED: "修改已有密码时需要输入当前密码。",
    CURRENT_PASSWORD_INVALID: "当前密码不正确。",
    INVALID_PASSWORD_UPDATE_REQUEST: "密码格式不正确，请确认至少 8 位。",
    PASSWORD_LENGTH_INVALID: "密码长度需为 8-72 位。",
    PASSWORD_PHONE_REQUIRED: "当前账号缺少手机号，不能设置手机号密码登录。",
  };
  return error ? (messages[error] ?? error) : "密码保存失败。";
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#067647]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]";
  return "rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted";
}
