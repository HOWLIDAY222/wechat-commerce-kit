"use client";

import { useEffect, useState } from "react";

type Remaining = { days: number; hours: number; minutes: number; seconds: number; complete: boolean };

export function ReleaseCountdown({ saleStartsAt }: { saleStartsAt: string }) {
  const [remaining, setRemaining] = useState<Remaining | null>(null);

  useEffect(() => {
    const update = () => setRemaining(calculateRemaining(saleStartsAt));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [saleStartsAt]);

  if (remaining?.complete) return <p className="mt-3 text-sm font-bold" role="status">购买入口开放时间已到，请刷新页面查看当前状态。</p>;

  const values = remaining ?? { days: 0, hours: 0, minutes: 0, seconds: 0, complete: false };
  return (
    <div className="mt-4" aria-label="距离购买入口开放" role="timer">
      <p className="text-xs font-bold text-muted">距离购买入口开放</p>
      <div className="mt-2 grid max-w-[340px] grid-cols-4 gap-2">
        <TimeUnit label="天" value={values.days} />
        <TimeUnit label="时" value={values.hours} />
        <TimeUnit label="分" value={values.minutes} />
        <TimeUnit label="秒" value={values.seconds} />
      </div>
    </div>
  );
}

function TimeUnit({ label, value }: { label: string; value: number }) {
  return <div className="grid h-16 place-items-center border border-[#d9d9d9] bg-white"><strong className="text-lg tabular-nums">{String(value).padStart(2, "0")}</strong><span className="text-[10px] font-bold text-muted">{label}</span></div>;
}

function calculateRemaining(value: string): Remaining {
  const milliseconds = Math.max(0, new Date(value).getTime() - Date.now());
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, complete: true };
  const totalSeconds = Math.floor(milliseconds / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    complete: false,
  };
}
