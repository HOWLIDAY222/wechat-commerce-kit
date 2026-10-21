import Link from "next/link";
import { PasswordForm } from "@/app/account/password-form";
import { ProfileForm } from "@/app/account/settings/profile-form";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { AccountShell } from "@/components/storefront/account-shell";
import { InfoPanel } from "@/components/storefront/storefront-ui";
import { FitAssistant } from "@/components/product/fit-assistant";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "账户设置",
  description: "编辑 MerchantKit 用户资料、手机号、邮箱和登录密码。",
};

type AccountProfile = {
  birthYear: number | null;
  countryCode: string | null;
  createdAt: Date | string;
  email: string | null;
  gender: string | null;
  id: string;
  name: string;
  marketingGranted: boolean;
  personalizationGranted: boolean;
  phone: string | null;
  preferredLocale: string | null;
  role: string;
  updatedAt: Date | string;
};

type AccountPasswordResponse = {
  ok: boolean;
  password: {
    hasPassword: boolean;
  };
};

export default async function AccountSettingsPage() {
  const [{ profile }, { password }] = await Promise.all([
    fetchAccountJson<{ ok: boolean; profile: AccountProfile }>("/api/account/profile"),
    fetchAccountJson<AccountPasswordResponse>("/api/account/password"),
  ]);
  return <AccountShell active="settings" title="账户设置" description="管理个人资料和登录密码。" actions={<Link className="vk-button vk-button-light" href="/account">返回账户首页</Link>}>
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
      <InfoPanel className="py-6"><ProfileForm initialProfile={profile} /></InfoPanel>
      <InfoPanel className="h-fit py-6"><PasswordForm initialHasPassword={password.hasPassword} /></InfoPanel>
    </div>
    <InfoPanel className="mt-10 max-w-3xl py-6"><FitAssistant title="我的尺码档案" /></InfoPanel>
  </AccountShell>;
}
