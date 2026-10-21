import { BrandLogo } from "@/components/brand-logo";
import { AdminLoginClient } from "@/app/admin/login/admin-login-client";
import { appConfig } from "@/lib/config";

export const metadata = {
  title: "后台登录",
  description: "MerchantKit 后台登录入口，支持管理员手机号验证码和手机号密码登录。",
};

export const dynamic = "force-dynamic";

export default function AdminLoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f3f4f6] px-4 py-8 text-[#101828]">
      <section className="w-full max-w-[520px] border border-[#d0d5dd] bg-white px-5 py-7 shadow-[0_20px_60px_rgba(16,24,40,0.08)] sm:px-8 sm:py-9">
        <header className="border-b border-[#e4e7ec] pb-6">
          <BrandLogo size="compact" />
          <h1 className="mt-3 text-[34px] font-semibold leading-tight sm:text-[40px]">后台登录</h1>
          <p className="mt-3 text-sm leading-6 text-[#667085]">仅限已授权的 ADMIN/OWNER 手机号登录。</p>
        </header>
        <div className="pt-6">
          <AdminLoginClient allowLocalMockLogin={appConfig.ENABLE_MOCK_ADMIN_LOGIN} />
        </div>
      </section>
    </main>
  );
}
