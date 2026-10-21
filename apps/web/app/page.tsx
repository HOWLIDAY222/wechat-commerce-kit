import { ManagedPage, generateManagedPageMetadata } from "@/components/site-builder/managed-page";

export const dynamic = "force-dynamic";
export const generateMetadata = () => generateManagedPageMetadata("home");

export default function HomePage() {
  return <ManagedPage pageKey="home" />;
}
