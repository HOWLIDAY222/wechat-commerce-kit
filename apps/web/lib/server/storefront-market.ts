import { headers } from "next/headers";
import { isDomesticHost } from "@/lib/storefront-market";

export async function isDomesticStorefront() {
  return isDomesticHost((await headers()).get("host"));
}
