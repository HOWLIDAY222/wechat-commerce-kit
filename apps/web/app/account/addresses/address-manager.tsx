"use client";

import { type FormEvent, useState } from "react";
import { InfoPanel } from "@/components/storefront/storefront-ui";

export type AccountAddress = {
  city: string;
  createdAt?: Date | string;
  detail: string;
  district?: string | null;
  id: string;
  isDefault: boolean;
  name: string;
  phone: string;
  postalCode?: string | null;
  province: string;
};

type AddressPayload = Omit<AccountAddress, "createdAt" | "id">;
type StatusTone = "idle" | "success" | "error";

export function AddressManager({ initialAddresses }: { initialAddresses: AccountAddress[] }) {
  const [addresses, setAddresses] = useState(initialAddresses);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState(initialAddresses.length > 0 ? "可维护常用收货地址、默认地址和联系电话。" : "还没有保存地址，可先新增一个常用地址。");
  const [tone, setTone] = useState<StatusTone>("idle");

  async function createAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy("create");
    setTone("idle");
    setMessage("正在保存地址...");
    const response = await requestAddress("/api/account/addresses", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readAddressPayload(new FormData(formElement))),
    });
    const payload = (await response.json().catch(() => ({}))) as { address?: AccountAddress; error?: string; ok?: boolean };
    setBusy(null);

    if (!response.ok || !payload.ok || !payload.address) {
      setTone("error");
      setMessage(formatAddressError(payload.error, "地址保存失败。"));
      return;
    }

    setTone("success");
    setMessage("地址已保存。");
    setAddresses((current) => {
      const next = payload.address!.isDefault ? current.map((item) => ({ ...item, isDefault: false })) : current;
      return [payload.address!, ...next];
    });
    formElement.reset();
  }

  async function updateAddress(event: FormEvent<HTMLFormElement>, addressId: string) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(addressId);
    setTone("idle");
    setMessage("正在更新地址...");
    const response = await requestAddress(`/api/account/addresses/${encodeURIComponent(addressId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readAddressPayload(new FormData(formElement))),
    });
    const payload = (await response.json().catch(() => ({}))) as { address?: AccountAddress; error?: string; ok?: boolean };
    setBusy(null);

    if (!response.ok || !payload.ok || !payload.address) {
      setTone("error");
      setMessage(formatAddressError(payload.error, "地址更新失败。"));
      return;
    }

    setTone("success");
    setMessage("地址已更新。");
    setEditingId(null);
    setAddresses((current) => current.map((item) => {
      if (payload.address!.isDefault) {
        return item.id === addressId ? payload.address! : { ...item, isDefault: false };
      }
      return item.id === addressId ? payload.address! : item;
    }));
  }

  async function setDefault(addressId: string) {
    await patchAddress(addressId, { isDefault: true }, "默认地址已更新。");
  }

  async function removeAddress(addressId: string) {
    if (!window.confirm("确认删除这个收货地址？")) return;
    setBusy(addressId);
    setTone("idle");
    setMessage("正在删除地址...");
    const response = await requestAddress(`/api/account/addresses/${encodeURIComponent(addressId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean };
    setBusy(null);

    if (!response.ok || !payload.ok) {
      setTone("error");
      setMessage(formatAddressError(payload.error, "地址删除失败。"));
      return;
    }

    setTone("success");
    setMessage("地址已删除。");
    setEditingId((current) => (current === addressId ? null : current));
    setAddresses((current) => current.filter((item) => item.id !== addressId));
  }

  async function patchAddress(addressId: string, body: Partial<AccountAddress>, successMessage: string) {
    setBusy(addressId);
    setTone("idle");
    setMessage("正在更新地址...");
    const response = await requestAddress(`/api/account/addresses/${encodeURIComponent(addressId)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { address?: AccountAddress; error?: string; ok?: boolean };
    setBusy(null);

    if (!response.ok || !payload.ok || !payload.address) {
      setTone("error");
      setMessage(formatAddressError(payload.error, "地址更新失败。"));
      return;
    }

    setTone("success");
    setMessage(successMessage);
    setAddresses((current) => current.map((item) => {
      if (payload.address!.isDefault) {
        return item.id === addressId ? payload.address! : { ...item, isDefault: false };
      }
      return item.id === addressId ? payload.address! : item;
    }));
  }

  const hasAddresses = addresses.length > 0;

  return (
    <div className={`grid gap-5 ${hasAddresses ? "xl:grid-cols-[minmax(0,1fr)_380px]" : "mx-auto w-full max-w-3xl"}`}>
      {hasAddresses ? <section className="grid content-start gap-4">
        <p className={statusClass(tone)} role="status">{message}</p>
        {addresses.map((address) => (
          <InfoPanel className="p-5" key={address.id}>
            {editingId === address.id ? (
              <form className="grid gap-4" onSubmit={(event) => void updateAddress(event, address.id)}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-xl font-black">编辑收货地址</h2>
                  {address.isDefault ? <span className="rounded-full bg-[#eef4ff] px-3 py-1 text-xs font-black text-brand">默认</span> : null}
                </div>
                <AddressFields address={address} busy={busy === address.id} />
                <div className="flex flex-wrap gap-2">
                  <button className="vk-button vk-button-dark min-h-10 px-4" disabled={busy === address.id} type="submit">
                    {busy === address.id ? "保存中..." : "保存修改"}
                  </button>
                  <button className="vk-button vk-button-light min-h-10 px-4" disabled={busy === address.id} onClick={() => setEditingId(null)} type="button">
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black">{address.name}</h2>
                    {address.isDefault ? <span className="rounded-full bg-[#eef4ff] px-3 py-1 text-xs font-black text-brand">默认</span> : null}
                  </div>
                  <p className="mt-2 text-sm font-bold text-muted">{maskPhone(address.phone)}</p>
                  <p className="mt-3 text-sm font-bold leading-6">
                    {address.province} {address.city} {address.district ?? ""} {address.detail}
                  </p>
                  {address.postalCode ? <p className="mt-1 text-xs font-bold text-muted">邮编：{address.postalCode}</p> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="vk-button vk-button-light min-h-9 px-4" disabled={busy === address.id} onClick={() => setEditingId(address.id)} type="button">
                    编辑
                  </button>
                  <button className="vk-button vk-button-light min-h-9 px-4" disabled={address.isDefault || busy === address.id} onClick={() => void setDefault(address.id)} type="button">
                    设为默认
                  </button>
                  <button className="vk-button vk-button-light min-h-9 px-4" disabled={busy === address.id} onClick={() => void removeAddress(address.id)} type="button">
                    删除
                  </button>
                </div>
              </div>
            )}
          </InfoPanel>
        ))}
      </section> : null}

      <div className="grid h-fit content-start gap-4">
        {!hasAddresses ? <p className={statusClass(tone)} role="status">{message}</p> : null}
        <InfoPanel className="h-fit p-5 md:p-7">
          <h2 className="text-xl font-black">新增地址</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-muted">保存常用收货地址后，结账时可以直接选择；第一条地址会作为默认地址。</p>
          <form className="mt-5 grid gap-4" onSubmit={createAddress}>
            <AddressFields busy={busy === "create"} compact={hasAddresses} />
            <button className="vk-button vk-button-dark h-11 w-full" disabled={busy === "create"} type="submit">
              {busy === "create" ? "保存中..." : "保存地址"}
            </button>
          </form>
        </InfoPanel>
      </div>
    </div>
  );
}

function AddressFields({ address, busy, compact = false }: { address?: AccountAddress; busy: boolean; compact?: boolean }) {
  return (
    <>
      <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
        <label className="vk-field">
          收货人
          <input defaultValue={address?.name ?? ""} disabled={busy} name="name" placeholder="姓名" required />
        </label>
        <label className="vk-field">
          手机号
          <input defaultValue={address?.phone ?? ""} disabled={busy} inputMode="tel" name="phone" placeholder="中国大陆手机号" required />
        </label>
        <label className="vk-field">
          省份
          <input defaultValue={address?.province ?? ""} disabled={busy} name="province" placeholder="山东省" required />
        </label>
        <label className="vk-field">
          城市
          <input defaultValue={address?.city ?? ""} disabled={busy} name="city" placeholder="青岛市" required />
        </label>
        <label className="vk-field">
          区县
          <input defaultValue={address?.district ?? ""} disabled={busy} name="district" placeholder="市南区" />
        </label>
        <label className="vk-field">
          邮编
          <input defaultValue={address?.postalCode ?? ""} disabled={busy} name="postalCode" placeholder="可选" />
        </label>
      </div>
      <label className="vk-field">
        详细地址
        <textarea defaultValue={address?.detail ?? ""} disabled={busy} name="detail" placeholder="街道、门牌号、楼层" required />
      </label>
      <label className="flex items-center gap-2 text-sm font-black">
        <input defaultChecked={Boolean(address?.isDefault)} disabled={busy} name="isDefault" type="checkbox" />
        设为默认地址
      </label>
    </>
  );
}

function readAddressPayload(form: FormData): AddressPayload {
  return {
    city: String(form.get("city") ?? "").trim(),
    detail: String(form.get("detail") ?? "").trim(),
    district: String(form.get("district") ?? "").trim() || undefined,
    isDefault: form.get("isDefault") === "on",
    name: String(form.get("name") ?? "").trim(),
    phone: String(form.get("phone") ?? "").trim(),
    postalCode: String(form.get("postalCode") ?? "").trim() || undefined,
    province: String(form.get("province") ?? "").trim(),
  };
}

function formatAddressError(error: string | undefined, fallback: string) {
  const messages: Record<string, string> = {
    NETWORK_ERROR: "连接中断，请刷新地址列表确认结果后再操作。",
    ADDRESS_CREATE_FAILED: "地址保存失败。",
    ADDRESS_DELETE_FAILED: "地址删除失败。",
    ADDRESS_NOT_FOUND: "地址不存在或不属于当前账户。",
    ADDRESS_UPDATE_FAILED: "地址更新失败。",
    AUTH_REQUIRED: "请先登录。",
    INVALID_ADDRESS: "请完整填写收货人、手机号、省市和详细地址。",
    INVALID_ADDRESS_UPDATE: "地址更新内容不完整。",
  };
  return error ? (messages[error] ?? error) : fallback;
}

async function requestAddress(url: string, init: RequestInit) {
  try { return await fetch(url, init); }
  catch { return Response.json({ ok: false, error: "NETWORK_ERROR" }, { status: 503 }); }
}

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#067647]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]";
  return "rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted";
}
