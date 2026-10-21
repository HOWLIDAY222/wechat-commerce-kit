import { CampaignManagedHome } from "@/components/product/campaign-managed-home";
import type { PageDocument } from "@/lib/site-builder";
import type { StorefrontProduct } from "@/lib/storefront-product";
type Asset = {id:string;url:string;altText:string|null;name:string};
export function HomePageRenderer(props:{assets:Map<string,Asset>;document:PageDocument;products:StorefrontProduct[]}) { return <CampaignManagedHome {...props}/>; }
