import { LoginClient } from "@/app/auth/login/login-client";

export const metadata = {
  title: "登录",
  description: "使用手机号验证码或手机号密码登录 MerchantKit 账户。",
};

export default function LoginPage() {
  return (
    <main className="vk-storefront consumer-login">
      <section>
        <h1 className="text-[32px] leading-tight">登录账户</h1>
        <p className="mt-4 text-sm leading-6 text-muted">查看订单、管理地址，继续选购。</p>
        <LoginClient />
      </section>
    </main>
  );
}
