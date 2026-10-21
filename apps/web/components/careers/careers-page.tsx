import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, ArrowLeft } from "lucide-react";
import { campaignAsset } from "@/lib/campaign-assets";
import { talentRoles } from "@/lib/careers-content";
import { OFFICIAL_EMAILS } from "@/lib/official-emails";
import { ApplicationForm } from "./application-form";
import styles from "./careers.module.css";

const traits = [
  ["对审美有判断，而不是只会执行。", "Have a point of view on aesthetics, beyond execution."],
  ["理解商业需要结果，也在意作品的质量。", "Care about commercial outcomes and the quality of the work."],
  ["愿意尝试新的工具和新的工作方法。", "Be curious about new tools and ways of working."],
  ["能够独立解决问题，也知道什么时候应该沟通。", "Solve problems independently and know when to communicate."],
  ["不必什么都会，但希望你真的擅长某件事情。", "You do not need to do everything. Bring something you do well."],
];
const ways = [
  ["小团队", "Small team", "真正参与一件事从想法到落地的全过程。", "Take part in a project from the first idea to its delivery."],
  ["直接沟通", "Direct conversation", "把问题说清楚，让信息流动得更顺畅。", "Make the issue clear and keep information moving."],
  ["项目协作", "Project collaboration", "围绕具体目标协作，明确每个人负责的部分。", "Work towards a clear goal with defined responsibilities."],
  ["结果导向", "Meaningful outcomes", "用作品、反馈和数据复盘，而不只看忙碌程度。", "Review the work, feedback and data, rather than busyness."],
  ["自主判断", "Room for judgment", "带着方案讨论，也为自己的判断负责。", "Bring a proposal to the conversation and own your decisions."],
  ["快速试错", "Test and learn", "从小范围尝试开始，把有效的方法留下。", "Start with a small experiment and keep what works."],
];

export function CareersPage({ english = false, selectedRole = "" }: { english?: boolean; selectedRole?: string }) {
  const l = english ? 1 : 0;
  const base = english ? "/en/careers" : "/careers";
  const options = talentRoles.map(role => ({ id: role.id, label: `${role.youth ? "VK NEXT · " : ""}${english ? role.en : role.zh}` }));
  options.push({ id: "open-introduction", label: english ? "Open introduction / Other strengths" : "开放自荐 / 其他专长" });
  return <main className={styles.page}>
    <section className={styles.hero}>
      <div className={styles.heroCopy}><span className={styles.eyebrow}>{english ? "PEOPLE / PRODUCT / POSSIBILITIES" : "产品 / 审美 / 新的可能"}</span><h1 aria-label="Join MerchantKit"><span aria-hidden="true">JOIN</span><BrandLogo size="hero" className={styles.heroBrand} decorative /></h1><p>{english ? "Make something new, with people who take the product seriously." : "和一群认真对待产品的人，一起把新的东西做出来。"}</p><a className={styles.link} href="#opportunities">{english ? "Explore our talent pool" : "了解人才储备方向"}<ArrowDownRight aria-hidden="true" size={18} strokeWidth={1.5} /></a></div>
      <div className={styles.heroImage}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img {...campaignAsset("IMG_0606")} sizes="(max-width: 760px) 100vw, 58vw" width="1920" height="1080" alt={english ? "MerchantKit white underwear campaign" : "MerchantKit 白色内衣系列品牌影像"} fetchPriority="high" /><span className={styles.heroCaption}>BRAND CAMPAIGN</span>
      </div>
    </section>
    <div className={styles.wrap}>
      <section className={styles.intro}><span className={styles.eyebrow}>A SMALL TEAM. A CLEAR POINT OF VIEW.</span><p>{english ? "MerchantKit is building a small team with a clear focus. We care about product, aesthetics, content and commercial efficiency — and about taking an idea all the way through." : "MerchantKit 正在建立一支小而清晰的团队。我们关注产品、审美、内容与商业效率，也希望每个人真正参与一件事情从想法到落地的全过程。"}</p></section>
      <section className={styles.section} id="opportunities" aria-labelledby="directions-title">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>TALENT POOL</span><h2 id="directions-title">{english ? "Seven areas. Real contributions." : "七个方向，做具体的事。"}</h2></div><p className={styles.muted}>{english ? "Talent introductions are welcome. These are not currently open vacancies." : "当前接受人才储备自荐，尚非正式在招职位。"}</p></div>
        <div className={styles.positions}>{talentRoles.filter(role => !role.youth).map(role => <article className={styles.card} key={role.id}><span className={styles.tag}>TALENT POOL</span><h3>{english ? role.en : role.zh}</h3><span className={styles.english}>{english ? "Future opportunities" : role.en}</span><p>{role.tags[l]}</p><Link className={styles.link} href={`${base}/${role.id}`}>{english ? "Explore the direction" : "查看方向详情"}<ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.5} /></Link></article>)}</div>
        <p className={`${styles.muted} mt-9`}>{english ? "Location, working arrangements and any specific opportunity will be discussed when confirmed." : "工作地点、合作方式及具体机会将在明确需求后另行沟通。"}</p>
      </section>
      <section className={`${styles.section} ${styles.traits}`}><div><span className={styles.eyebrow}>WHAT MATTERS TO US</span><h2 className="mt-5">{english ? "What you bring." : "我们希望你是这样的人。"}</h2></div><ol>{traits.map((pair, i) => <li key={pair[0]}><span aria-hidden="true">0{i + 1}</span>{pair[l]}</li>)}</ol></section>
      <section className={styles.section}><div className={styles.sectionHead}><div><span className={styles.eyebrow}>HOW WE WORK</span><h2>{english ? "Clear thinking. Shared work." : "我们如何工作。"}</h2></div></div><div className={styles.work}>{ways.map(pair => <article key={pair[0]}><h3>{pair[l]}</h3><p>{pair[l + 2]}</p></article>)}</div></section>
      <section className={`${styles.next} ${styles.anchor}`} id="vk-next"><div className={styles.nextHeader}><div><span className={styles.eyebrow}>{english ? "EMERGING TALENT / TALENT POOL" : "青年人才计划 / 人才储备"}</span><h2>VK NEXT</h2><span className={styles.muted}>{english ? "For students and emerging creatives." : "面向在校生与初入行业的年轻人。"}</span></div><p>{english ? "We want emerging talent to take part in real projects. Introduce the work you care about — from a course, a collaboration or an idea of your own." : "我们希望年轻人真正参与项目。无论是课程作业、合作作品，还是你主动开始的一次尝试，都可以成为认识你的起点。"}</p></div><div className={styles.nextLinks}>{talentRoles.filter(role => role.youth).map(role => <Link href={`${base}/${role.id}`} key={role.id}><span>{english ? role.en : role.zh}</span><ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.5} /></Link>)}</div><p className={`${styles.muted} mt-5`}>{english ? "This is a talent pool, not a confirmed internship offer." : "当前为青年人才储备，不代表已有实习名额或确定的用工安排。"}</p></section>
      <section className={`${styles.section} ${styles.application}`} id="apply"><div className={styles.applicationIntro}><span className={styles.eyebrow}>INTRODUCE YOURSELF</span><h2>{english ? "Show us what you do." : "让我们认识你。"}</h2><p className={styles.muted}>{english ? "For brand, design, photography and content, please include your work. Show the thinking behind it and the part you played." : "品牌、设计、摄影和内容方向，请附作品集。我们想看到你的作品、背后的判断，以及你负责的部分。"}</p><p className={`${styles.muted} mt-6`}>{english ? "You can also write to " : "也可以直接发邮件至 "}<a className="underline break-all" href={`mailto:${OFFICIAL_EMAILS.hr}`}>{OFFICIAL_EMAILS.hr}</a></p></div><ApplicationForm key={`${english}-${selectedRole}`} english={english} selectedRole={selectedRole} options={options} /></section>
      <section className={styles.empty}><span className={styles.eyebrow}>THERE IS MORE THAN ONE WAY IN</span><h2>{english ? "No matching direction?" : "没有找到适合你的方向？"}</h2><p className={styles.muted}>{english ? "If your skills could bring something new to MerchantKit, introduce yourself. Product, supply chain, video and other perspectives are welcome." : "如果你认为自己的能力能够为 MerchantKit 带来新的东西，可以直接介绍你自己。产品、供应链、影像及其他领域的专长，也值得被看见。"}</p><Link className={styles.link} href={`${base}?role=open-introduction#apply`}>{english ? "Send an open introduction" : "提交开放自荐"}<ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.5} /></Link><p className={`${styles.muted} mt-8`}>{english ? "For business collaborations, " : "商务合作请 "}<Link className="underline" href={english ? "/en/contact" : "/contact"}>{english ? "find the right contact." : "查看对应联系方式。"}</Link></p></section>
    </div>
  </main>;
}
