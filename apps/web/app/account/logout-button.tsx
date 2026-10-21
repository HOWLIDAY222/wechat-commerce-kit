"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => undefined);
    window.location.assign("/auth/login");
  }

  return (
    <button className="vk-button vk-button-light inline-flex items-center gap-2" disabled={submitting} onClick={logout} type="button">
      <LogOut className="h-4 w-4" />
      {submitting ? "退出中..." : "退出登录"}
    </button>
  );
}
