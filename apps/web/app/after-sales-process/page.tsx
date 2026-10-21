import { ManagedPage, generateManagedPageMetadata } from "@/components/site-builder/managed-page";
export const dynamic = "force-dynamic";
export const generateMetadata = () => generateManagedPageMetadata("after-sales-process");
export default function Page() { return <ManagedPage pageKey="after-sales-process" />; }
