import { OFFICIAL_EMAILS } from "@/lib/official-emails";

const contacts = [
  ["info", "总咨询", "General enquiries"],
  ["support", "客服售后", "Customer support"],
  ["sales", "销售和渠道", "Sales and distribution"],
  ["finance", "财务对账开票", "Finance and invoicing"],
  ["marketing", "品牌市场", "Brand and marketing"],
  ["hr", "人事招聘", "Careers"],
] as const;

export function EmailDirectory({ english = false }: { english?: boolean }) {
  return <section aria-labelledby="email-directory-title" className="mt-10 border-t border-black/15 pt-8">
    <h2 className="text-2xl" id="email-directory-title">{english ? "The right contact" : "按事项联系"}</h2>
    <dl className="mt-6 grid gap-x-10 sm:grid-cols-2">
      {contacts.map(([key, zh, en]) => <div className="min-w-0 border-b border-black/10 py-5" key={key}>
        <dt className="text-sm text-black/60">{english ? en : zh}</dt>
        <dd className="mt-1"><a className="inline-flex min-h-11 max-w-full items-center break-all text-sm underline underline-offset-4" href={`mailto:${OFFICIAL_EMAILS[key]}`}>{OFFICIAL_EMAILS[key]}</a></dd>
      </div>)}
    </dl>
    <details className="mt-5 text-sm text-black/60">
      <summary className="min-h-11 cursor-pointer py-3">{english ? "System and mailbox administration" : "系统与邮箱管理"}</summary>
      <p className="mt-2 break-all leading-7">{english ? "System notifications: " : "系统通知邮件："}{OFFICIAL_EMAILS.noreply}</p>
      <p className="text-xs leading-6">{english ? "Please send enquiries to the relevant contact above, rather than replying to this address." : "咨询请使用上方对应邮箱，请勿向此地址投递简历或咨询。"}</p>
      <p className="mt-3 break-all leading-7">{english ? "Mailbox administration: " : "邮箱管理员："}<a className="underline underline-offset-4" href={`mailto:${OFFICIAL_EMAILS.postmaster}`}>{OFFICIAL_EMAILS.postmaster}</a></p>
    </details>
  </section>;
}
