"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

export function MiniProgramLaunch({ slug, released }: { slug?: string; released: boolean }) {
  const [message, setMessage] = useState(released ? "正在连接微信…" : "小程序正在审核，正式发布后即可从这里打开。");
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(released);
  const initialRequest = useRef<Promise<Response> | null>(null);
  const lock = useRef(released);
  const request = useCallback((kind: "code" | "link") => fetch("/api/miniprogram/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, kind }) }), [slug]);

  const openWechat = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const response = await request("link");
      const data = await response.json();
      if (!response.ok || !data.ok || !data.url) throw new Error("unavailable");
      setUrl(data.url);
      setMessage("正在打开微信；如未跳转，请点击下方按钮。");
      window.location.assign(data.url);
    } catch { setMessage("暂时无法打开微信，请稍后重试，或使用下方小程序名称搜索。"); }
    finally { lock.current = false; setBusy(false); }
  }, [request]);

  useEffect(() => {
    if (!released) return;
    let active = true;
    let objectUrl = "";
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    // Share the initial promise across Strict Mode re-renders, but not visitors.
    if (!initialRequest.current) initialRequest.current = request(mobile ? "link" : "code");
    initialRequest.current.then(async response => {
      const copy = response.clone();
      if (!copy.ok) throw new Error("unavailable");
      if (mobile) {
        const data = await copy.json();
        if (!data.ok || !data.url) throw new Error("unavailable");
        if (active) { setUrl(data.url); setMessage("正在打开微信；如未跳转，请点击下方按钮。"); window.location.assign(data.url); }
      } else {
        const blob = await copy.blob();
        if (active) { objectUrl = URL.createObjectURL(blob); setCode(objectUrl); setMessage("用微信扫一扫，打开对应的小程序页面。"); }
      }
    }).catch(() => { if (active) setMessage("暂时无法连接微信，请重试，或使用下方小程序名称搜索。"); }).finally(() => { if (active) { lock.current = false; setBusy(false); } });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [released, request]);

  return <div className="my-6 border-y border-line py-6">
    <p className="text-sm leading-7" role="status">{message}</p>
    {code ? <Image unoptimized className="my-5 h-auto w-52 max-w-full" width={208} height={208} src={code} alt="使用微信扫码打开小程序" /> : null}
    {released ? url ? <a className="vk-button vk-button-dark mt-4" href={url}>打开微信小程序</a> : <button className="vk-button vk-button-dark mt-4" type="button" disabled={busy} onClick={() => void openWechat()}>{busy ? "正在连接…" : "打开微信小程序"}</button> : null}
  </div>;
}
