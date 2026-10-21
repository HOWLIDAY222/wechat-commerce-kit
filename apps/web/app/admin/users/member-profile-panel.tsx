"use client";

import { useEffect, useState } from "react";
import type { MemberAccountProfile } from "@/lib/commerce/member-profile";

export function MemberProfilePanel({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<MemberAccountProfile | null>(null);
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading"); setProfile(null);
    fetch(`/api/admin/users/${encodeURIComponent(userId)}/member-profile`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok || !result.ok || !result.profile) throw Error("Unavailable"); return result.profile as MemberAccountProfile; })
      .then(result => { if (!controller.signal.aborted) { setProfile(result); setState("loaded"); } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [userId, retry]);
  return <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-white p-4">
    <h2 className="text-base font-black">会员资料</h2>
    {state === "loading" ? <p className="mt-3 text-xs text-[#697386]">正在加载会员资料…</p> : null}
    {state === "error" ? <div className="mt-3 text-xs"><p>会员资料暂时无法加载，请稍后重试。</p><button className="mt-2 underline underline-offset-4" onClick={() => setRetry(value => value + 1)} type="button">重新加载</button></div> : null}
    {state === "loaded" && profile ? <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
      <Field label="注册状态" value={profile.registeredAt ? "已完成会员注册" : "未完成会员注册"} />
      <Field label="昵称" value={profile.displayName} /><Field label="姓氏" value={profile.surname} /><Field label="名字" value={profile.givenName} />
      <Field label="性别" value={profile.gender === "MALE" ? "男" : profile.gender === "FEMALE" ? "女" : profile.gender === "UNSPECIFIED" ? "不愿透露" : ""} />
      <Field label="当前所在区域" value={profile.region.join(" / ")} />
      <Field label="出生日期" value={profile.birthday} />
      <Field label="会员注册时间" value={dateLabel(profile.registeredAt)} /><Field label="资料更新时间" value={dateLabel(profile.updatedAt)} />
    </dl> : null}
  </section>;
}
function Field({ label, value }: { label: string; value: string | null }) { return <div><dt className="text-[#697386]">{label}</dt><dd className="mt-1 break-words font-bold">{value || "未填写"}</dd></div>; }
function dateLabel(value: string | null) { return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : ""; }
