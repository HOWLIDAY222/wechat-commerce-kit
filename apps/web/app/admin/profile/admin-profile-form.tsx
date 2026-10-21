"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";

type AdminProfileFormProps = {
  email?: string | null;
  hasPassword: boolean;
  name: string;
  phone?: string | null;
};

type StatusTone = "idle" | "success" | "error";

export function AdminProfileForm({ email, hasPassword, name, phone }: AdminProfileFormProps) {
  const router = useRouter();
  const [profileMessage, setProfileMessage] = useState("可修改当前后台账号的姓名、手机号和邮箱。");
  const [profileTone, setProfileTone] = useState<StatusTone>("idle");
  const [passwordHasPassword, setPasswordHasPassword] = useState(hasPassword);
  const [passwordMessage, setPasswordMessage] = useState(
    hasPassword ? "修改密码需要输入当前密码。" : "当前账号还没有设置密码，设置后可使用手机号 + 密码登录后台。",
  );
  const [passwordTone, setPasswordTone] = useState<StatusTone>("idle");

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!window.confirm("确认更新当前管理员个人资料？手机号会影响后台短信和密码登录。")) return;
    setProfileTone("idle");
    setProfileMessage("正在保存...");

    const response = await fetch("/api/admin/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(form.get("email") ?? "").trim() || null,
        name: String(form.get("name") ?? "").trim(),
        phone: String(form.get("phone") ?? "").trim(),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setProfileTone("error");
      setProfileMessage(formatProfileError(result.error, response.status));
      return;
    }

    setProfileTone("success");
    setProfileMessage("个人资料已更新。");
    router.refresh();
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (passwordHasPassword && !currentPassword) {
      setPasswordTone("error");
      setPasswordMessage("这个账号已经设置过登录密码，请先填写当前密码。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordTone("error");
      setPasswordMessage("两次输入的新密码不一致。");
      return;
    }
    if (!window.confirm("确认更新当前管理员登录密码？更新后请使用新密码登录后台。")) return;

    setPasswordTone("idle");
    setPasswordMessage("正在更新密码...");
    const response = await fetch("/api/admin/me/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: currentPassword || undefined,
        newPassword,
        confirmPassword,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      if (result.error === "CURRENT_PASSWORD_REQUIRED") setPasswordHasPassword(true);
      setPasswordTone("error");
      setPasswordMessage(formatPasswordError(result.error, response.status));
      return;
    }

    formElement.reset();
    setPasswordHasPassword(true);
    setPasswordTone("success");
    setPasswordMessage("管理员登录密码已更新。");
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      <form className="grid gap-4 rounded-[8px] border border-[#d8dde5] bg-white p-5" onSubmit={submitProfile}>
        <div>
          <p className="text-xs font-black text-[#697386]">个人资料</p>
          <h2 className="mt-1 text-lg font-black">账号基础信息</h2>
        </div>
        <label className="vk-field">
          姓名 / 昵称
          <input autoComplete="name" defaultValue={name} maxLength={40} name="name" required />
        </label>
        <label className="vk-field">
          管理员手机号
          <input autoComplete="tel" defaultValue={phone ?? ""} inputMode="tel" maxLength={20} name="phone" placeholder="请输入 11 位手机号" required />
        </label>
        <label className="vk-field">
          邮箱
          <input autoComplete="email" defaultValue={email ?? ""} maxLength={120} name="email" placeholder="可选" type="email" />
        </label>
        <button className="vk-button vk-button-dark w-max" type="submit">保存个人资料</button>
        <p className={statusClass(profileTone)} role="status">{profileMessage}</p>
      </form>

      <form className="grid gap-4 rounded-[8px] border border-[#d8dde5] bg-white p-5" onSubmit={submitPassword}>
        <div>
          <p className="text-xs font-black text-[#697386]">登录安全</p>
          <h2 className="mt-1 text-lg font-black">修改管理员密码</h2>
        </div>
        <label className="vk-field">
          当前密码
          <input
            autoComplete="current-password"
            name="currentPassword"
            placeholder={passwordHasPassword ? "请输入当前密码" : "首次设置可不填；已设置过密码则必填"}
            required={passwordHasPassword}
            type="password"
          />
        </label>
        <label className="vk-field">
          新密码
          <input autoComplete="new-password" minLength={8} maxLength={72} name="newPassword" placeholder="至少 8 位" required type="password" />
        </label>
        <label className="vk-field">
          确认新密码
          <input autoComplete="new-password" minLength={8} maxLength={72} name="confirmPassword" placeholder="再次输入新密码" required type="password" />
        </label>
        <button className="vk-button vk-button-dark w-max" type="submit">{passwordHasPassword ? "更新密码" : "设置登录密码"}</button>
        <p className={statusClass(passwordTone)} role="status">{passwordMessage}</p>
      </form>
    </div>
  );
}

function formatProfileError(error: string | undefined, status: number) {
  const messages: Record<string, string> = {
    ADMIN_PHONE_IN_USE: "这个手机号已被其他管理员使用。",
    ADMIN_EMAIL_IN_USE: "这个邮箱已被其他管理员使用。",
    ADMIN_PROFILE_NOT_FOUND: "未找到当前管理员资料，请重新登录。",
    INVALID_ADMIN_PHONE: "请输入正确的大陆手机号。",
    INVALID_ADMIN_PROFILE_UPDATE: "请填写姓名、手机号和有效邮箱。",
  };
  return error && messages[error] ? messages[error] : formatAdminActionError(error, status, "个人资料保存");
}

function formatPasswordError(error: string | undefined, status: number) {
  const messages: Record<string, string> = {
    CURRENT_PASSWORD_REQUIRED: "这个账号已经有登录密码，请先填写当前密码。",
    CURRENT_PASSWORD_INVALID: "当前密码不正确，请重新输入。",
    PASSWORD_CONFIRM_MISMATCH: "两次输入的新密码不一致。",
    PASSWORD_LENGTH_INVALID: "新密码需要 8 到 72 位。",
    INVALID_ADMIN_PASSWORD_UPDATE: "新密码需要 8 到 72 位。",
    PASSWORD_PHONE_REQUIRED: "请先在个人资料里绑定有效手机号，再设置登录密码。",
  };
  return error && messages[error] ? messages[error] : formatAdminActionError(error, status, "密码更新");
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-3 py-2 text-sm font-black text-[#027a48]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-3 py-2 text-sm font-black text-[#d92d20]";
  return "rounded-[8px] border border-[#d8dde5] px-3 py-2 text-sm font-bold text-[#697386]";
}
