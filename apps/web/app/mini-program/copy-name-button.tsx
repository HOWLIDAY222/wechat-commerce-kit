"use client";

import { useState } from "react";
import { MINI_PROGRAM_NAME } from "@/lib/storefront-market";

export function CopyNameButton() {
  const [message, setMessage] = useState("");
  async function copyName() {
    try {
      await navigator.clipboard.writeText(MINI_PROGRAM_NAME);
      setMessage("名称已复制，可在微信小程序中搜索。");
    } catch {
      setMessage(`请长按上方名称复制，或在微信中输入：${MINI_PROGRAM_NAME}`);
    }
  }
  return <div>
    <button className="vk-button vk-button-dark w-full sm:w-auto" type="button" onClick={() => void copyName()}>复制小程序名称</button>
    <p className="mt-3 min-h-6 text-sm text-muted" role="status">{message}</p>
  </div>;
}
