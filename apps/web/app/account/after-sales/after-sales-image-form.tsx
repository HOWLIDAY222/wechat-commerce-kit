"use client";

import { type FormEvent, useState } from "react";

type ImageFormState = {
  message: string;
  tone: "idle" | "success" | "error";
};

export function AfterSalesImageForm({ afterSalesNo, disabled }: { afterSalesNo: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<ImageFormState>({
    message: disabled ? "当前售后状态不能补充凭证。" : "质量问题可以继续补充图片凭证。",
    tone: "idle",
  });

  async function submitImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setState({ message: "正在记录凭证...", tone: "idle" });
    const response = await fetch(`/api/account/after-sales/${encodeURIComponent(afterSalesNo)}/images`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl: String(form.get("imageUrl") ?? "").trim() }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    setBusy(false);

    if (!response.ok || !payload.ok) {
      setState({ message: payload.error ?? "凭证记录失败。", tone: "error" });
      return;
    }

    setState({ message: "图片凭证已记录，刷新后可查看。", tone: "success" });
    formElement.reset();
  }

  return (
    <form className="mt-5 grid gap-3" onSubmit={submitImage}>
      <label className="vk-field">
        图片 URL
        <input disabled={disabled || busy} name="imageUrl" placeholder="https://example.com/photo.jpg" required type="url" />
      </label>
      <button className="vk-button vk-button-light w-max" disabled={disabled || busy} type="submit">
        {busy ? "记录中..." : "补充凭证"}
      </button>
      <p className={statusClass(state.tone)} role="status">{state.message}</p>
    </form>
  );
}

function statusClass(tone: ImageFormState["tone"]) {
  if (tone === "success") return "text-sm font-black text-[#067647]";
  if (tone === "error") return "text-sm font-black text-[#b42318]";
  return "text-sm font-bold text-muted";
}
