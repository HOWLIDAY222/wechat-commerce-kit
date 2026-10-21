import { cookies } from "next/headers";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { BagClient } from "@/app/bag/bag-client";
import { StorefrontPage } from "@/components/storefront/storefront-ui";
import { readCurrentUserSession } from "@/lib/auth/session";
import { cartCookieName, getCartSummary, resolveCartKey } from "@/lib/services/cart-service";

export const metadata = {
  title: "购物袋",
  description: "查看 MerchantKit 购物袋商品、数量、小计，并进入结账流程。",
};

export default async function BagPage() {
  const session = await readCurrentUserSession();
  const currentKey = (await cookies()).get(cartCookieName)?.value;
  const cartKey = await resolveCartKey(currentKey, session?.userId);
  const cart = await getCartSummary(cartKey, session?.userId);

  return (
    <StorefrontPage fullBleed>
      <BagClient initialCart={cart} domestic={await isDomesticStorefront()} />
    </StorefrontPage>
  );
}
