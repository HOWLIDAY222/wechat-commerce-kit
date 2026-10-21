"use client";

import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/brand-loader";
import styles from "./brand-page-loading.module.css";

export function BrandPageLoading() {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 15000);
    return () => window.clearTimeout(timer);
  }, []);
  return <main className={styles.page} aria-busy={!timedOut}>
    {timedOut ? <div className={styles.recovery} role="alert">
      <p>加载时间较长，请重新尝试。</p>
      <button type="button" onClick={() => window.location.reload()}>重新加载 / Reload</button>
    </div> : <BrandLoader label="正在加载页面 / Loading page" />}
  </main>;
}
