import { ManagedPage, generateManagedPageMetadata } from "@/components/site-builder/managed-page";
export const dynamic = "force-dynamic";
export const generateMetadata = () => generateManagedPageMetadata("official-channels");
export default function Page() { return <ManagedPage pageKey="official-channels" />; }
