import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { redirect } from "next/navigation";
import { readCurrentUserSession } from "@/lib/auth/session";
import { MemberWallet } from "./wallet";
export const dynamic="force-dynamic";
export const metadata={title:'会员与优惠券'};
export default async function Page(){if(!await readCurrentUserSession())redirect('/auth/login?next=/account/membership');return <main className="vk-container py-12"><h1 className="text-3xl">会员与优惠券</h1><MemberWallet domestic={await isDomesticStorefront()}/></main>;}
