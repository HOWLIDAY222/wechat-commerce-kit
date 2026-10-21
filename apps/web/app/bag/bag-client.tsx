"use client";

import Image from "next/image";
import Link from "next/link";
import { MINI_PROGRAM_PATH } from "@/lib/storefront-market";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState, formatMoney } from "@/components/storefront/storefront-ui";
import { persistCartCookie } from "@/lib/client/cart-cookie";
import { getConsumerErrorMessage } from "@/lib/client/consumer-error-message";

type CartItem = {
  id: string;
  productSlug: string;
  style?:string;
  skuCode: string;
  productCode: string;
  productName: string;
  productImage?: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  maxProductQuantity?: number;
};

type CartSummary = {
  items: CartItem[];
  itemCount: number;
  key?: string;
  discountCents: number;
  payableAmountCents: number;
  subtotalCents: number;
};

type StatusTone = "idle" | "success" | "error";

export function BagClient({ initialCart, domestic = false }: { initialCart: CartSummary; domestic?: boolean }) {
  const [cart, setCart] = useState<CartSummary>(initialCart);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<StatusTone>("idle");
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const mutationLock = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const startedRevision = revision.current;
    async function syncCart() {
      try {
      const response = await fetch("/api/cart", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; cart?: CartSummary; error?: string };
      if (!response.ok || !result.ok || !result.cart || controller.signal.aborted || revision.current !== startedRevision) return;
      persistCartCookie(result.cart.key);
      setCart(result.cart);
      setMessage("");
      } catch {
        if (!controller.signal.aborted && revision.current === startedRevision) {
          setTone("error"); setMessage("暂时无法刷新购物袋，请检查连接后重试。");
        }
      }
    }

    void syncCart();
    return () => controller.abort();
  }, []);

  async function updateQuantity(itemId: string, quantity: number) {
    if (mutationLock.current) return;
    mutationLock.current = true;
    revision.current += 1;
    setBusyItemId(itemId);
    setTone("idle");
    setMessage("正在更新购物袋...");
    try {
    const response = await fetch("/api/cart", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId, quantity }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; cart?: CartSummary; error?: string };
    setBusyItemId(null);
    if (!response.ok || !result.ok || !result.cart) {
      setTone("error");
      setMessage(getConsumerErrorMessage(result.error, "购物袋更新失败，请稍后重试。"));
      return;
    }
    persistCartCookie(result.cart.key);
    setCart(result.cart);
    setTone("success");
    setMessage(quantity === 0 ? "商品已移除。" : "数量已更新。");
    } catch {
      setTone("error");
      setMessage("连接中断，未能确认更新结果。请刷新购物袋后重试。");
    } finally {
      mutationLock.current = false;
      setBusyItemId(null);
    }
  }

  const items = cart.items;
  const productQuantities = new Map<string, number>();
  for (const item of items) productQuantities.set(item.productSlug+':'+(item.style??''), (productQuantities.get(item.productSlug+':'+(item.style??'')) ?? 0) + item.quantity);

  return (
    <section className={`grid min-h-[55svh] ${items.length ? "lg:grid-cols-[minmax(0,1.8fr)_minmax(340px,1fr)]" : ""}`}>
      <div className="min-w-0 px-5 py-9 md:px-8 md:py-12 lg:px-12">
        <div className="flex items-end justify-between gap-5 border-b border-black/15 pb-7">
          <h1 className="text-[34px] font-semibold md:text-[44px]">购物袋 <span className="font-normal text-black/45">({cart.itemCount})</span></h1>
          {items.length > 0 ? <p className="text-2xl font-semibold md:text-[34px]">{formatMoney(cart.payableAmountCents)}</p> : null}
        </div>
        <div>
        {items.map((item) => (
          <article className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-b border-black/15 py-7 sm:grid-cols-[170px_minmax(0,1fr)]" key={item.id}>
            <Link className="relative aspect-[4/5] overflow-hidden bg-[#f2f0ee]" href={`/products/${item.productSlug}`}>
                <Image src={item.productImage || "/assets/brand/product-placeholder.webp"} alt={item.productName} fill sizes="170px" className="object-cover" />
              </Link>
            <div className="grid min-w-0 content-between gap-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link className="line-clamp-2 text-lg font-semibold hover:underline" href={`/products/${item.productSlug}`}>{item.productName}</Link>
                  <p className="mt-2 text-sm text-black/55">{item.color}</p>
                  <p className="mt-1 text-sm text-black/55">尺码 {item.size}</p>
                </div>
                <p className="whitespace-nowrap text-base font-semibold">{formatMoney(item.unitPriceCents * item.quantity)}</p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="inline-flex h-11 border border-black/20">
                  <button aria-label={`减少 ${item.size} 码数量`} className="grid w-11 place-items-center" disabled={busyItemId !== null || item.quantity <= 1} onClick={() => void updateQuantity(item.id, item.quantity - 1)} type="button"><Minus className="h-4 w-4" /></button>
                  <span className="grid w-12 place-items-center border-x border-black/20 text-sm font-semibold">{item.quantity}</span>
                  <button aria-label={`增加 ${item.size} 码数量`} className="grid w-11 place-items-center" disabled={busyItemId !== null || (productQuantities.get(item.productSlug+':'+(item.style??'')) ?? item.quantity) >= (item.maxProductQuantity ?? 99)} onClick={() => void updateQuantity(item.id, item.quantity + 1)} type="button"><Plus className="h-4 w-4" /></button>
                </div>
                <button aria-label={`删除 ${item.productName} ${item.size} 码`} className="flex min-h-11 items-center gap-2 text-sm text-black/55 hover:text-black hover:underline" disabled={busyItemId !== null} onClick={() => void updateQuantity(item.id, 0)} type="button"><Trash2 className="h-4 w-4" />删除</button>
              </div>
            </div>
          </article>
        ))}
        {items.length === 0 ? <div className="py-10"><EmptyState actionHref="/products/x1-air-white" actionLabel="选购 X1 Air" title="购物袋里还没有商品。" /></div> : null}
        {items.length > 0 ? (
          <div className="flex justify-end pt-6">
            <Link className="text-sm font-semibold underline underline-offset-4" href="/shop">继续购物</Link>
          </div>
        ) : null}
        {message ? <p className={statusClass(tone)} role="status">{message}</p> : null}
      </div>
      </div>
      {items.length > 0 ? <aside className="h-fit border-t border-black/15 px-5 py-9 md:px-8 md:py-12 lg:sticky lg:top-8 lg:border-l lg:border-t-0 lg:px-10">
        <h2 className="text-2xl font-semibold">订单摘要 <span className="font-normal text-black/45">({cart.itemCount})</span></h2>
        <div className="mt-8 grid gap-5 text-sm">
          <Row label={`商品小计（${cart.itemCount}件）`} value={formatMoney(cart.subtotalCents)} />
          {cart.discountCents > 0 ? <Row label="预售组合优惠" value={`-${formatMoney(cart.discountCents)}`} /> : null}
          <Row label="配送费用" value={domestic ? "小程序内确认" : "结账时确认"} />
          <div className="border-t border-black/15 pt-5">
            <Row label="预计总计" value={formatMoney(cart.payableAmountCents)} strong />
          </div>
        </div>
        <p className="mt-6 border-t border-black/15 pt-5 text-sm leading-6 text-black/55">{domestic ? "国内购买通过微信小程序完成。网页购物袋不会自动转入小程序，请在小程序内重新确认商品、规格、数量与最终金额。" : "税费、配送方式与最终金额将在结账页确认。结账前需要登录账户。"}</p>
        {busyItemId ? <button className="vk-button vk-button-dark mt-8 h-14 w-full" disabled>正在更新…</button> : <Link className="vk-button vk-button-dark mt-8 h-14 w-full text-base" data-vk-event={domestic ? undefined : "begin_checkout"} href={domestic ? MINI_PROGRAM_PATH : "/checkout"}>
          {domestic ? "小程序购买" : "去结算"}
        </Link>}
      </aside> : null}
    </section>
  );
}

function Row({ label, strong, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-xl font-semibold text-black" : ""}`}>
      <span className="text-black/55">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "mt-6 border-t border-black/10 pt-4 text-sm font-semibold text-[#067647]";
  if (tone === "error") return "mt-6 border-t border-black/10 pt-4 text-sm font-semibold text-[#b42318]";
  return "mt-6 border-t border-black/10 pt-4 text-sm text-black/55";
}
