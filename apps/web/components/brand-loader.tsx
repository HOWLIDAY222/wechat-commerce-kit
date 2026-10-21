import { BrandLogo } from "@/components/brand-logo";
import styles from "./brand-loader.module.css";

/** Render only while the parent is actually waiting for a page or media resource. */
export function BrandLoader({ label = "正在加载", fill = false }: { label?: string; fill?: boolean }) {
  return <div className={`${styles.loader} ${fill ? styles.fill : ""}`} role="status" aria-live="polite">
    <div className={styles.mark}><BrandLogo size="hero" inverted decorative /></div>
    <span className={styles.hidden}>{label}</span>
  </div>;
}
