import { ManagedPage, generateManagedPageMetadata } from "@/components/site-builder/managed-page";
export const dynamic = "force-dynamic";
export const generateMetadata = () => generateManagedPageMetadata("payment-methods");
export default function Page() { return <ManagedPage pageKey="payment-methods" />; }
