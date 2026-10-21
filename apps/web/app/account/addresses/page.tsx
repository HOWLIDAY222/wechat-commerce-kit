import Link from "next/link";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { MINI_PROGRAM_PATH } from "@/lib/storefront-market";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { AddressManager, type AccountAddress } from "@/app/account/addresses/address-manager";
import { AccountShell } from "@/components/storefront/account-shell";

export const dynamic = "force-dynamic";

export const metadata = {
  description: "管理 MerchantKit 账户收货地址、默认地址和配送联系信息。",
  title: "收货地址",
};

export default async function AddressesPage() {
  const domestic = await isDomesticStorefront();
  const { addresses } = await fetchAccountJson<{ addresses: AccountAddress[]; ok: boolean }>("/api/account/addresses");

  return (
    <AccountShell
      active="addresses"
      actions={<Link className="vk-button vk-button-light" href={domestic ? MINI_PROGRAM_PATH : "/checkout"}>{domestic ? "小程序购买" : "去结账"}</Link>}
      description="保存和管理常用收货地址。"
      eyebrow="地址管理"
      title="收货地址"
    >
      <AddressManager initialAddresses={addresses} />
    </AccountShell>
  );
}
