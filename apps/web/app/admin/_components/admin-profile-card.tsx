"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClipboardList, Gauge, Settings, UserCircle } from "lucide-react";
import { formatRoleLabel } from "@/lib/display-labels";

type AdminProfile = {
  name: string;
  role: string;
};

export function AdminProfileCard() {
  const [profile, setProfile] = useState<AdminProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/me", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json())
      .then((result) => {
        if (!cancelled && result?.ok && result.user) {
          setProfile({ name: result.user.name, role: result.user.role });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-[8px] border border-[#e4e7ec] bg-white px-4 py-3 shadow-sm">
      <Link className="flex items-center gap-3" href="/admin/profile">
        <UserCircle className="h-9 w-9 text-[#344054]" strokeWidth={1.8} />
        <div className="min-w-0">
          <p className="truncate text-sm font-black">{profile?.name ?? "管理员"}</p>
          <p className="mt-0.5 truncate text-xs font-bold text-[#697386]">{profile ? formatRoleLabel(profile.role) : "个人资料"}</p>
        </div>
      </Link>
      <div className="mt-4 grid grid-cols-4 gap-2 text-[#667085]">
        <Link className="flex h-9 items-center justify-center rounded-[8px] border border-[#eef1f5] hover:bg-[#f8fafc]" href="/admin/audit" title="审计日志">
          <ClipboardList className="h-4 w-4" />
        </Link>
        <Link className="flex h-9 items-center justify-center rounded-[8px] border border-[#eef1f5] hover:bg-[#f8fafc]" href="/admin/settings" title="系统设置">
          <Settings className="h-4 w-4" />
        </Link>
        <Link className="flex h-9 items-center justify-center rounded-[8px] border border-[#eef1f5] hover:bg-[#f8fafc]" href="/admin/settings#status" title="系统状态">
          <Gauge className="h-4 w-4" />
        </Link>
        <Link className="flex h-9 items-center justify-center rounded-[8px] border border-[#eef1f5] hover:bg-[#f8fafc]" href="/admin/profile" title="个人资料">
          <UserCircle className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
