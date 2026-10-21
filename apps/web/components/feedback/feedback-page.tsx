import { FeedbackForm } from "./feedback-form";
import styles from "./feedback.module.css";
export function FeedbackPage({ english = false, initialPage = "" }: { english?: boolean; initialPage?: string }) {
  return <main className={styles.page}><header className={styles.hero}><span className={styles.eyebrow}>WEBSITE FEEDBACK</span><h1>{english ? "Help us improve your experience." : "帮助我们改善网站体验"}</h1><p>{english ? "We would love to hear about your visit. This short survey takes about 30–60 seconds. Your feedback will help us improve the website." : "我们希望了解你在本网站上的使用体验。完成本问卷大约需要 30–60 秒，你的反馈将用于网站体验优化。"}</p></header><FeedbackForm english={english} initialPage={initialPage} /></main>;
}
