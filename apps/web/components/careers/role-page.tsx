import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, ArrowLeft } from "lucide-react";
import type { TalentRole } from "@/lib/careers-content";
import styles from "./careers.module.css";

export function RolePage({ role, english = false }: { role: TalentRole; english?: boolean }) {
  const l = english ? 1 : 0;
  const base = english ? "/en/careers" : "/careers";
  return <main className={styles.page}><div className={`${styles.wrap} ${styles.details}`}>
    <Link className={styles.link} href={base}><ArrowLeft aria-hidden="true" size={18} strokeWidth={1.5} />{english ? "Join MerchantKit" : "返回加入我们"}</Link>
    <header className={styles.detailsHeader}><span className={styles.tag}>{role.youth ? "VK NEXT / TALENT POOL" : "TALENT POOL"}</span><h1>{english ? role.en : role.zh}</h1><p className={styles.muted}>{role.tags[l]}</p><p className="mt-5">{role.intro[l]}</p></header>
    <h2>{english ? "What you could contribute" : "你可以参与的事情"}</h2><ul>{role.duties[l].map(item => <li key={item}>{item}</li>)}</ul>
    <h2>{english ? "What we would like to see" : "我们希望看到什么"}</h2><p>{role.evidence[l]}</p>
    <h2>{english ? "About this talent pool" : "关于本次人才储备"}</h2><p className={styles.muted}>{english ? "This is an invitation to introduce your work, not an active vacancy or offer. Location, working arrangements, timing and terms are not yet set. We may contact you when a suitable need is confirmed; submitting does not guarantee an interview." : "这是一次人才储备邀请，并非正式在招职位或录用承诺。工作地点、用工形式、开始时间及具体条件尚未确定；有匹配需求时再联系沟通，提交资料不保证获得面试。"}</p>
    <Link className={styles.link} href={`${base}?role=${role.id}#apply`}>{english ? "Introduce yourself in this area" : "向这个方向自荐"}<ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.5} /></Link>
  </div></main>;
}
