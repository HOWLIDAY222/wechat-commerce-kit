"use client";

import { useState } from "react";

type OrderShippingContactProps = { name: string; phone: string; address: string };

export function OrderShippingContact({ name, phone, address }: OrderShippingContactProps) {
  const [message, setMessage] = useState("");

  async function copyShippingContact() {
    const text = [`收货人：${name}`, `收货电话：${phone}`, `收货地址：${address}`].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("收货信息已复制，可粘贴到快递寄件页面。");
    } catch {
      setMessage("暂时无法自动复制，请选中上方收货信息复制。");
    }
  }

  return (
    <section className="mt-5 border-t border-[#d8dde5] pt-4" aria-label="订单收货信息">
      <h3 className="text-sm font-black">收货信息</h3>
      <dl className="mt-3 grid select-text gap-3 text-xs font-bold">
        <ContactRow label="收货人" value={name || "未记录"} />
        <ContactRow label="收货电话" value={phone || "未记录"} />
        <ContactRow label="收货地址" value={address || "未记录"} />
      </dl>
      <button className="vk-button vk-button-light mt-3" disabled={!phone || !address} onClick={copyShippingContact} type="button">复制收货信息</button>
      <p className="mt-2 text-xs leading-5 text-[#697386]">以上为下单时保存的收货资料；账户绑定手机号可能不同，请以此处寄件。</p>
      {message ? <p className="mt-2 text-xs leading-5 text-[#697386]" role="status">{message}</p> : null}
    </section>
  );
}

function ContactRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3"><dt className="text-[#697386]">{label}</dt><dd className="break-all text-[#111827]">{value}</dd></div>;
}
