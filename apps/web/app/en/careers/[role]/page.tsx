import { notFound } from "next/navigation";
import { getTalentRole } from "@/lib/careers-content";
import { RolePage } from "@/components/careers/role-page";
export async function generateMetadata({ params }: { params: Promise<{ role: string }> }) {
  const role = getTalentRole((await params).role); if (!role) notFound();
  return { title: `${role.en} · Talent pool`, description: role.intro[1], alternates: { canonical: `/en/careers/${role.id}`, languages: { "zh-CN": `/careers/${role.id}`, en: `/en/careers/${role.id}` } } };
}
export default async function Page({ params }: { params: Promise<{ role: string }> }) { const role = getTalentRole((await params).role); if (!role) notFound(); return <RolePage role={role} english />; }
