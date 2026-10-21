import { ManagedPage, generateManagedPageMetadata } from "@/components/site-builder/managed-page";
export const dynamic = "force-dynamic";
export const generateMetadata = () => generateManagedPageMetadata("about");
export default function Page() { return <ManagedPage pageKey="about" />; }
