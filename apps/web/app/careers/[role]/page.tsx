import { notFound } from "next/navigation";
import { getTalentRole } from "@/lib/careers-content";
import { RolePage } from "@/components/careers/role-page";
export async function generateMetadata({ params }: { params: Promise<{ role: string }> }) {
  const role = getTalentRole((await params).role); if (!role) notFound();
  return { title: `${role.zh} · 人才储备`, description: role.intro[0], alternates: { canonical: `/careers/${role.id}`, languages: { "zh-CN": `/careers/${role.id}`, en: `/en/careers/${role.id}` } } };
}
export default async function Page({ params }: { params: Promise<{ role: string }> }) { const role = getTalentRole((await params).role); if (!role) notFound(); return <RolePage role={role} />; }
