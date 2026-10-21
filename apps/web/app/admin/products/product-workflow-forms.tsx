"use client";

import { useAdminSubmit } from "@/lib/client/use-admin-submit";
import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
import { formatStatusLabel } from "@/lib/display-labels";
import { parseProductFeatures } from "@/lib/product-merchandising";

const adminImageAccept = "image/jpeg,image/png,image/webp,image/avif";
const maxAdminImageBytes = 5 * 1024 * 1024;

type Status = {
  tone: "idle" | "success" | "error";
  message: string;
};

type ImagePreview = {
  name: string;
  sizeLabel: string;
  url: string;
};

type SkuOption = {
  id: string;
  skuCode: string;
  color: string;
  size: string;
  priceCents: number;
  stockQuantity: number;
  reservedQuantity: number;
  status: string;
};

type ProductImageOption = {
  id?: string;
  imageUrl?: string;
  alt?: string | null;
  sortOrder?: number;
};

type MediaAssetOption = {
  id: string;
  name: string;
  url: string;
  altText?: string | null;
};

type ProductOption = {
  id: string;
  slug?: string;
  code: string;
  name: string;
  image?: string | null;
  category: string;
  scene?: string | null;
  summary: string;
  description?: string | null;
  silhouette?: string | null;
  rise?: string | null;
  coverage?: string | null;
  supportLevel?: string | null;
  fabricComposition?: string | null;
  features?: string[];
  fitNote?: string | null;
  careInstructions?: string | null;
  packSize?: number | null;
  status: string;
  saleMode?: string;
  saleStartsAt?: string | null;
  estimatedShipAt?: string | null;
  countdownEnabled?: boolean;
  showPrice?: boolean;
  sortOrder: number;
  skus: SkuOption[];
  images?: ProductImageOption[];
};

type AdminMutationResult = {
  ok?: boolean;
  error?: string;
  product?: unknown;
  result?: {inventoryLog?:{beforeQuantity:number;afterQuantity:number;actorId:string;createdAt:string}};
};

export function ProductCreateForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: "先创建商品档案；成功后进入图片管理，再继续维护 SKU、价格和库存。",
  });
  const {busy,guard} = useAdminSubmit(setStatus);
  const [firstImagePreview, setFirstImagePreview] = useState<ImagePreview | null>(null);

  useEffect(() => {
    return () => {
      if (firstImagePreview?.url) URL.revokeObjectURL(firstImagePreview.url);
    };
  }, [firstImagePreview?.url]);

  function handleFirstImageChange(event: ChangeEvent<HTMLInputElement>) {
    setFirstImagePreview(readImagePreviewFromInput(event, "首张产品图", setStatus));
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submitter = (event.nativeEvent as { submitter?: HTMLElement }).submitter;
    const intent = submitter instanceof HTMLButtonElement && submitter.value === "draft" ? "draft" : "publish";
    if (!window.confirm(intent === "draft" ? "确认保存商品档案？创建后会写入审计日志。" : "确认创建商品并继续完善图片、SKU、价格和库存？资料完整后才能上架。")) return;

    const form = new FormData(formElement);
    const firstImage = form.get("firstImage");
    const result = await submitJson(
      "POST",
      "/api/admin/products",
      {
        code: getString(form, "code"),
        name: getString(form, "name"),
        category: getString(form, "category"),
        scene: getOptionalString(form, "scene"),
        summary: getString(form, "summary"),
        description: getOptionalString(form, "description"),
        silhouette: getString(form, "silhouette"),
        rise: getString(form, "rise"),
        coverage: getString(form, "coverage"),
        supportLevel: getString(form, "supportLevel"),
        fabricComposition: getString(form, "fabricComposition"),
        features: parseProductFeatures(getString(form, "features")),
        fitNote: getString(form, "fitNote"),
        careInstructions: getString(form, "careInstructions"),
        packSize: getOptionalInt(form, "packSize") ?? null,
        status: "HIDDEN",
        sortOrder: getOptionalInt(form, "sortOrder"),
      },
      setStatus,
    );
    if (!isProductResult(result?.product)) return;

    if (firstImage instanceof File && firstImage.size > 0) {
      setStatus({ tone: "idle", message: "商品已创建，正在绑定首张产品图..." });
      const imageForm = new FormData();
      imageForm.append("file", firstImage);
      imageForm.append("alt", getOptionalString(form, "firstImageAlt") ?? getString(form, "name"));
      imageForm.append("sortOrder", "0");
      const imageResponse = await fetch(`/api/admin/products/${encodeURIComponent(result.product.id)}/images`, {
        method: "POST",
        body: imageForm,
      });
      const imageResult = (await imageResponse.json().catch(() => ({}))) as AdminMutationResult;
      if (!imageResponse.ok || !imageResult.ok) {
        setStatus({ tone: "error", message: `商品已创建，但产品图上传失败：${formatAdminError(imageResult.error, imageResponse.status)}` });
        router.replace(`/admin/products/${encodeURIComponent(result.product.id)}/images`);
        router.refresh();
        return;
      }
    }

    formElement.reset();
    setFirstImagePreview(null);
    setStatus({
      tone: "success",
      message: intent === "draft" ? "商品草稿已保存。下一步：补齐主图、SKU、价格、库存和详情后再上架。" : "商品已提交。下一步：检查产品图，然后维护 SKU、价格和库存。",
    });
    router.replace(`/admin/products/${encodeURIComponent(result.product.id)}/images`);
    router.refresh();
  }

  return (
    <section className="mt-4 pb-24">
      <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black text-[#697386]">商品发布</p>
            <h2 className="mt-1 text-xl font-black">分区发布流程</h2>
            <p className="mt-1 text-xs font-bold text-[#697386]">按主图、标题、类目、属性、规格、价格、库存、详情、配送售后和上架状态逐步补齐。</p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#ecfdf3] px-3 py-2 text-xs font-black text-[#027a48]">
            <span className="h-2 w-2 rounded-full bg-[#12b76a]" />
            必填已完成 / 未完成
          </div>
        </div>
        <PublishChecklist />
      </div>

      <form className="mt-3 grid gap-3 lg:grid-cols-2" id="admin-product-create-form" onSubmit={e=>guard(submitProduct)(e)}>
        <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4 lg:col-span-2">
          <SectionTitle required subtitle="建议 3-5 张主图；这里先绑定首张图，更多图片在创建后进入图片管理。" title="1. 商品主图" />
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <label className="vk-field">
              首张产品图
              <input accept={adminImageAccept} name="firstImage" onChange={handleFirstImageChange} type="file" />
            </label>
            <Field label="首图说明" name="firstImageAlt" placeholder="商品正面图 / 细节图" />
            <div className="lg:col-span-2" data-admin-first-image-preview="true">
              {firstImagePreview ? (
                <div className="grid gap-2 rounded-[8px] bg-[#f4f6f8] p-3 md:max-w-sm">
                  <Image
                    alt="首图预览"
                    className="aspect-[4/3] w-full rounded-[8px] border border-[#d8dde5] object-cover"
                    height={240}
                    src={firstImagePreview.url}
                    unoptimized
                    width={320}
                  />
                  <p className="break-all text-xs font-black text-[#697386]">首图预览：{firstImagePreview.name} / {firstImagePreview.sizeLabel}</p>
                </div>
              ) : (
                <p className="rounded-[8px] bg-[#f4f6f8] px-3 py-3 text-xs font-bold leading-5 text-[#697386]">
                  未完成。选择后会随商品创建自动上传，创建成功后进入图片管理页继续补齐详情图。
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4 lg:col-span-2">
          <SectionTitle required subtitle="标题、编码和类目决定前台展示与检索，访问地址由商品编码自动生成。" title="2. 标题 / 类目 / 基础属性" />
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Field label="商品编码" name="code" placeholder="VK-NEW" required />
            <Field label="商品名称" name="name" placeholder="MerchantKit 新商品" required />
            <Field label="分类" name="category" placeholder="运动内裤" required />
            <Field label="使用场景" name="scene" placeholder="训练 / 通勤" />
            <Field label="排序" name="sortOrder" placeholder="100" type="number" />
          </div>
        </div>

        <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
          <SectionTitle required subtitle="创建后进入 SKU 管理维护颜色、尺码、售价和初始库存。" title="3. 规格 / 价格 / 库存" />
          <div className="mt-3 grid gap-2 rounded-[8px] bg-[#f4f6f8] p-3 text-xs font-bold leading-5 text-[#697386]">
            <p>规格：创建后在 SKU 管理维护颜色和尺码。</p>
            <p>价格：创建后在 SKU 管理改价，避免列表页直接改价格字段。</p>
            <p>库存：创建后在库存调整页通过入库、盘点修正、报损、售后回补写流水。</p>
          </div>
        </div>

        <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
          <SectionTitle required subtitle="详情、配送、售后和上架状态决定商品是否可以对外稳定销售。" title="4. 详情 / 配送售后 / 上架状态" />
          <div className="mt-3 grid gap-3">
            <label className="vk-field">
              商品摘要
              <textarea name="summary" placeholder="给客户看的卖点摘要" required />
            </label>
            <label className="vk-field">
              详情说明
              <textarea name="description" placeholder="可选：后台记录用的商品详情说明" />
            </label>
            <p className="rounded-[8px] bg-[#f4f6f8] px-3 py-3 text-xs font-bold leading-5 text-[#697386]">
              配送政策、售后政策和发货时效使用系统运营设置；密钥、支付服务和短信服务不在商品发布页编辑。
            </p>
          </div>
        </div>

        <p className={`${statusClass(status.tone)} lg:col-span-2`} role="status">{status.message}</p>
      </form>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8dde5] bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_1.1fr_1.4fr]">
          <p className="hidden text-xs font-black text-[#027a48] sm:block">必填已完成</p>
          <button className="vk-button vk-button-light min-h-12 px-3 text-sm" form="admin-product-create-form" name="intent" type="submit" value="draft">
            保存草稿
          </button>
          <button className="vk-button vk-button-dark min-h-12 px-3 text-sm" form="admin-product-create-form" name="intent" type="submit" value="publish">
            创建并继续完善
          </button>
        </div>
      </div>
    </section>
  );
}

function PublishChecklist() {
  const sections = ["商品主图", "商品标题", "商品类目", "商品属性", "商品规格", "售卖价格", "库存", "商品详情", "配送售后", "上架状态"];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {sections.map((section, index) => (
        <div className="rounded-[8px] border border-[#edf0f3] bg-[#f8fafc] px-3 py-3" key={section}>
          <p className="text-[11px] font-black text-[#98a2b3]">{String(index + 1).padStart(2, "0")}</p>
          <p className="mt-1 text-sm font-black">{section}</p>
          <p className="mt-1 text-xs font-bold text-[#697386]">{index < 3 ? "必填未完成" : "创建后维护"}</p>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ required, subtitle, title }: { required?: boolean; subtitle: string; title: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-black">{title}</h3>
        {required ? <span className="text-sm font-black text-[#d92d20]">*</span> : null}
      </div>
      <p className="mt-1 text-xs font-bold leading-5 text-[#697386]">{subtitle}</p>
    </div>
  );
}

export function ProductInfoForm({ product }: { product: ProductOption }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: "商品资料修改只影响商品档案和前台展示，不在这里调整价格或库存。",
  });
  const {busy,guard} = useAdminSubmit(setStatus);

  async function submitProductUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("确认保存商品资料变更？该操作会写入审计日志。")) return;
    const form = new FormData(event.currentTarget);
    const result = await submitJson(
      "PATCH",
      `/api/admin/products/${encodeURIComponent(product.id)}`,
      {
        name: getString(form, "name"),
        category: getString(form, "category"),
        scene: getOptionalString(form, "scene"),
        summary: getString(form, "summary"),
        description: getOptionalString(form, "description"),
        silhouette: getString(form, "silhouette"),
        rise: getString(form, "rise"),
        coverage: getString(form, "coverage"),
        supportLevel: getString(form, "supportLevel"),
        fabricComposition: getString(form, "fabricComposition"),
        features: parseProductFeatures(getString(form, "features")),
        fitNote: getString(form, "fitNote"),
        careInstructions: getString(form, "careInstructions"),
        packSize: getOptionalInt(form, "packSize") ?? null,
        status: getString(form, "status"),
        sortOrder: getOptionalInt(form, "sortOrder"),
      },
      setStatus,
    );
    if (result?.ok) {
      setStatus({ tone: "success", message: "商品资料已保存。下一步：如需改价、改库存或图片，请进入对应页面。" });
      router.refresh();
    }
  }

  return (
    <form className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4" onSubmit={e=>guard(submitProductUpdate)(e)}>
      <p className="text-xs font-black text-[#697386]">操作区</p>
      <h2 className="text-base font-black">维护商品资料</h2>
      <Field defaultValue={product.name} label="商品名称" name="name" placeholder="商品名称" required />
      <Field defaultValue={product.category} label="分类" name="category" placeholder="分类" required />
      <Field defaultValue={product.scene ?? ""} label="使用场景" name="scene" placeholder="训练 / 通勤" />
      <label className="vk-field">
        商品摘要
        <textarea defaultValue={product.summary} name="summary" placeholder="给客户看的卖点摘要" required />
      </label>
      <label className="vk-field">
        详情说明
        <textarea defaultValue={product.description ?? ""} name="description" placeholder="面向消费者说明商品结构和已确认信息" />
      </label>
      <div className="grid gap-3 border-t border-[#d8dde5] pt-3 md:grid-cols-2">
        <Field defaultValue={product.silhouette ?? ""} label="版型" name="silhouette" placeholder="三角 / 平角 / 四角" />
        <Field defaultValue={product.rise ?? ""} label="腰位" name="rise" placeholder="低腰 / 中腰 / 高腰" />
        <Field defaultValue={product.coverage ?? ""} label="包裹度" name="coverage" placeholder="例如：后片适中包裹" />
        <Field defaultValue={product.supportLevel ?? ""} label="支撑感" name="supportLevel" placeholder="例如：轻度支撑" />
        <Field defaultValue={product.fabricComposition ?? ""} label="面料成分" name="fabricComposition" placeholder="按水洗标填写完整成分及比例" />
        <Field defaultValue={product.packSize?.toString() ?? ""} label="包装数量" name="packSize" placeholder="1" type="number" />
        <Field defaultValue={product.features?.join("，") ?? ""} label="功能特点" name="features" placeholder="使用逗号分隔" />
        <Field defaultValue={product.fitNote ?? ""} label="贴合说明" name="fitNote" placeholder="说明贴合程度、腿口和腰带感受" />
      </div>
      <label className="vk-field">
        洗护方式
        <textarea defaultValue={product.careInstructions ?? ""} name="careInstructions" placeholder="按水洗标填写洗涤、漂白、熨烫和干燥要求" />
      </label>
      <Field defaultValue={product.sortOrder.toString()} label="排序" name="sortOrder" placeholder="100" type="number" />
      <StatusSelect defaultValue={product.status} />
      <button className="vk-button vk-button-dark" type="submit" disabled={busy}>保存商品资料</button>
      <p className={statusClass(status.tone)} role="status">{status.message}</p>
    </form>
  );
}

export function ProductReleaseForm({ product }: { product: ProductOption }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: "公开展示和允许购买分开控制。设置为预售或现货后，仍需全局交易开关处于开放状态。",
  });
  const {busy,guard} = useAdminSubmit(setStatus);

  async function submitReleaseUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("确认保存发售设置？这可能改变顾客是否可以购买该商品。")) return;
    const form = new FormData(event.currentTarget);
    const result = await submitJson(
      "PATCH",
      `/api/admin/products/${encodeURIComponent(product.id)}`,
      {
        saleMode: getString(form, "saleMode"),
        saleStartsAt: getNullableIsoDate(form, "saleStartsAt"),
        estimatedShipAt: getNullableIsoDate(form, "estimatedShipAt"),
        countdownEnabled: form.get("countdownEnabled") === "on",
        showPrice: form.get("showPrice") === "on",
      },
      setStatus,
    );
    if (result?.ok) {
      setStatus({ tone: "success", message: "发售设置已保存。请在前台商品页核对状态、时间和购买入口。" });
      router.refresh();
    }
  }

  return (
    <form className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-white p-4" onSubmit={e=>guard(submitReleaseUpdate)(e)}>
      <p className="text-xs font-black text-[#697386]">交易控制</p>
      <h2 className="text-base font-black">发售设置</h2>
      <label className="vk-field">
        商品发售状态
        <select defaultValue={product.saleMode ?? "SHOWCASE"} name="saleMode">
          <option value="SHOWCASE">仅展示</option>
          <option value="PREORDER">预售</option>
          <option value="IN_STOCK">现货</option>
          <option value="PAUSED">暂停购买</option>
        </select>
      </label>
      <Field defaultValue={toDateTimeLocal(product.saleStartsAt)} label="开放时间" name="saleStartsAt" placeholder="" type="datetime-local" />
      <Field defaultValue={toDateTimeLocal(product.estimatedShipAt)} label="预计发货时间" name="estimatedShipAt" placeholder="" type="datetime-local" />
      <label className="flex items-center gap-3 text-sm font-black">
        <input defaultChecked={product.countdownEnabled} name="countdownEnabled" type="checkbox" />
        在公开页面显示倒计时
      </label>
      <label className="flex items-center gap-3 text-sm font-black">
        <input defaultChecked={product.showPrice} name="showPrice" type="checkbox" />
        在公开页面显示价格
      </label>
      <button className="vk-button vk-button-dark" type="submit" disabled={busy}>保存发售设置</button>
      <p className={statusClass(status.tone)} role="status">{status.message}</p>
    </form>
  );
}

export function ProductSkuManager({ product }: { product: ProductOption }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSkuId = searchParams.get("skuId");
  const hasSkus = product.skus.length > 0;
  const defaultSkuCode = `${product.code}-DEFAULT`.toUpperCase().replace(/[^A-Z0-9-]/g, "-");
  const [activeSkuId, setActiveSkuId] = useState(selectedSkuId ?? (product.skus.find(s => s.status === "ACTIVE") ?? product.skus[0])?.id ?? "");
  const selectedSku = useMemo(
    () => product.skus.find((sku) => sku.id === activeSkuId) ?? product.skus[0],
    [activeSkuId, product.skus],
  );
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: hasSkus
      ? "SKU 管理用于颜色尺码、上架状态和销售价；库存调整请进入库存调整页。"
      : "当前商品还没有 SKU。先新增一个 SKU，填写销售价和初始库存，保存后就能改价和调库存。",
  });
  const {busy,guard} = useAdminSubmit(setStatus);

  async function submitSkuCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("确认新增这个 SKU？新增后会写入审计日志。")) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await submitJson(
      "POST",
      `/api/admin/products/${encodeURIComponent(product.id)}/skus`,
      {
        skuCode: getString(form, "skuCode"),
        color: getString(form, "color"),
        size: getString(form, "size"),
        priceCents: getMoneyCents(form, "priceYuan"),
        stockQuantity: getInt(form, "stockQuantity"),
        reservedQuantity: getOptionalInt(form, "reservedQuantity"),
        status: getString(form, "status"),
      },
      setStatus,
    );
    if (result?.ok) {
      setStatus({ tone: "success", message: "SKU 已新增。下一步：核对前台价格，必要时进入库存调整页补库存。" });
      formElement.reset();
      router.refresh();
    }
  }

  async function submitSkuUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSku) return;
    if (!window.confirm(`确认更新 SKU ${selectedSku.skuCode}？价格或状态变化会影响前台展示。`)) return;
    const form = new FormData(event.currentTarget);
    const result = await submitJson(
      "PATCH",
      `/api/admin/skus/${encodeURIComponent(selectedSku.id)}`,
      {
        color: getString(form, "color"),
        size: getString(form, "size"),
        priceCents: getMoneyCents(form, "priceYuan"),
        status: getString(form, "status"),
      },
      setStatus,
    );
    if (result?.ok) {
      setStatus({ tone: "success", message: "SKU 已更新。下一步：检查商品详情和前台价格展示。" });
      router.refresh();
    }
  }

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
        <p className="text-xs font-black text-[#697386]">SKU 管理</p>
        <h2 className="mt-1 text-xl font-black">现有 SKU</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[760px] w-full text-left text-xs">
            <thead className="text-[#697386]">
              <tr className="border-b border-[#d8dde5]">
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3">规格</th>
                <th className="py-2 pr-3">价格</th>
                <th className="py-2 pr-3">库存</th>
                <th className="py-2 pr-3">状态</th>
                <th className="py-2 pr-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6eaf0]">
              {!hasSkus ? (
                <tr>
                  <td className="py-5 pr-3 text-sm font-bold text-[#697386]" colSpan={6}>
                    暂无 SKU。请先在右侧新增一个 SKU，SKU 是商品价格和库存的最小单位。
                  </td>
                </tr>
              ) : null}
              {product.skus.map((sku) => (
                <tr key={sku.id}>
                  <td className="py-3 pr-3 font-black">{sku.skuCode}</td>
                  <td className="py-3 pr-3 font-bold">{sku.color} / {sku.size}</td>
                  <td className="py-3 pr-3 font-black">{formatMoney(sku.priceCents)}</td>
                  <td className="py-3 pr-3 font-bold">可售 {sku.stockQuantity - sku.reservedQuantity} / 锁定 {sku.reservedQuantity}</td>
                  <td className="py-3 pr-3 font-bold">{formatStatusLabel(sku.status)}</td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-3">
                      <button className="vk-admin-link" onClick={() => setActiveSkuId(sku.id)} type="button">编辑 SKU / 价格</button>
                      <Link className="vk-admin-link" href={`/admin/products/${encodeURIComponent(product.id)}/inventory?skuId=${encodeURIComponent(sku.id)}`}>
                        调库存
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4">
        <form className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4" key={selectedSku?.id ?? "sku-edit"} onSubmit={e=>guard(submitSkuUpdate)(e)}>
          <p className="text-xs font-black text-[#697386]">价格调整</p>
          <h2 className="text-base font-black">{selectedSku ? selectedSku.skuCode : "暂无 SKU"}</h2>
          <SkuSelect name="skuId" onChange={setActiveSkuId} skus={product.skus} value={selectedSku?.id ?? ""} />
          {!selectedSku ? (
            <p className="rounded-[8px] border border-dashed border-[#b8cffc] bg-[#f4f8ff] px-3 py-2 text-xs font-bold leading-5 text-[#155eef]">
              这个商品还没有 SKU，不能直接改价。请先用下方表单创建 SKU。
            </p>
          ) : null}
          <Field defaultValue={selectedSku?.color ?? ""} disabled={busy || !selectedSku} label="颜色" name="color" placeholder="黑色" required />
          <Field defaultValue={selectedSku?.size ?? ""} disabled={busy || !selectedSku} label="尺码" name="size" placeholder="M" required />
          <Field defaultValue={selectedSku ? (selectedSku.priceCents / 100).toFixed(2) : ""} disabled={busy || !selectedSku} label="新销售价（元）" name="priceYuan" placeholder="69.00" required type="number" step="0.01" />
          <StatusSelect defaultValue={selectedSku?.status ?? "ACTIVE"} />
          <button className="vk-button vk-button-dark" disabled={busy || !selectedSku} type="submit">保存 SKU / 价格</button>
        </form>

        <form className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-white p-4" onSubmit={e=>guard(submitSkuCreate)(e)}>
          <p className="text-xs font-black text-[#697386]">{hasSkus ? "新增颜色尺码" : "创建第一个 SKU"}</p>
          {!hasSkus ? (
            <p className="text-xs font-bold leading-5 text-[#697386]">
              新建商品必须至少有一个 SKU，商城才知道售价、规格和库存。没有多规格时可用“默认 / 均码”。
            </p>
          ) : null}
          <Field defaultValue={hasSkus ? "" : defaultSkuCode} label="SKU 编码" name="skuCode" placeholder="VK-NEW-BLK-M" required />
          <Field defaultValue={hasSkus ? "" : "默认"} label="颜色" name="color" placeholder="黑色" required />
          <Field defaultValue={hasSkus ? "" : "均码"} label="尺码" name="size" placeholder="M" required />
          <Field label="销售价（元）" name="priceYuan" placeholder="129.00" required type="number" step="0.01" />
          <Field defaultValue={hasSkus ? "" : "0"} label="初始库存" name="stockQuantity" placeholder="50" required type="number" />
          <Field defaultValue="0" label="锁定库存" name="reservedQuantity" placeholder="0" type="number" />
          <StatusSelect />
          <button className="vk-button vk-button-dark" type="submit" disabled={busy}>{hasSkus ? "新增 SKU" : "创建 SKU / 启用改价库存"}</button>
        </form>
      </div>
      <p className={`${statusClass(status.tone)} lg:col-span-2`} role="status">{status.message}</p>
    </section>
  );
}

export function ProductInventoryAdjust({ product }: { product: ProductOption }) {
  const router = useRouter();
  const request = useRef<{key:string;fingerprint:string}|null>(null);
  const [adjustment,setAdjustment]=useState("RESTOCK");
  const [quantityInput,setQuantityInput]=useState("");
  const searchParams = useSearchParams();
  const selectedSkuId = searchParams.get("skuId");
  const [activeSkuId, setActiveSkuId] = useState(selectedSkuId ?? (product.skus.find(s => s.status === "ACTIVE") ?? product.skus[0])?.id ?? "");
  const selectedSku = product.skus.find((sku) => sku.id === activeSkuId) ?? product.skus[0];
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: "支持到货入库、盘点清零和报损，每次操作都保留变更前后与操作人。",
  });
  const {busy,guard} = useAdminSubmit(setStatus);

  async function submitInventory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSku) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const action = getString(form, "action");
    const quantity = getInt(form, "quantity");
    const actionLabel = action === "RESTOCK" ? "到货入库" : action === "DAMAGE" ? "报损" : "盘点修正";
    const fingerprint=JSON.stringify([selectedSku.id,action,quantity,getOptionalString(form,"note"),selectedSku.stockQuantity]);
    if(request.current?.fingerprint!==fingerprint)request.current={key:crypto.randomUUID(),fingerprint};
    if (!window.confirm(`确认对 ${selectedSku.skuCode} 执行${actionLabel}，数量 ${quantity}？`)) return;
    const result = await submitJson(
      "POST",
      `/api/admin/skus/${encodeURIComponent(selectedSku.id)}/inventory`,
      {
        action,
        quantity,
        requestId: request.current.key,
        expectedStock: selectedSku.stockQuantity,
        note: getOptionalString(form, "note"),
      },
      setStatus,
    );
    if (result?.ok) {
      request.current=null;setQuantityInput("");
      const log=result.result?.inventoryLog;setStatus({tone:"success",message:log?'库存已保存：'+log.beforeQuantity+' → '+log.afterQuantity+'；操作时间 '+new Date(log.createdAt).toLocaleString('zh-CN')+'。下方可查看操作人及完整流水。':'库存已更新，请核对下方流水。'});
      formElement.reset();
      router.refresh();
    }
  }

  if (!product.skus.length) {
    return (
      <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-white p-5">
        <p className="text-xs font-black text-[#697386]">库存调整</p><Link className="underline text-sm" href={"/admin/inventory/logs?productId="+product.id+"&skuId="+(selectedSku?.id||"")}>查看此规格的真实库存流水</Link>
        <h2 className="mt-1 text-xl font-black">请先创建 SKU</h2>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-[#697386]">
          当前商品还没有 SKU，因此没有可调整的库存。请先创建一个 SKU 并填写销售价、初始库存；创建后这里会显示入库和盘点修正入口。
        </p>
        <Link className="vk-button vk-button-dark mt-4 w-fit px-5" href={`/admin/products/${encodeURIComponent(product.id)}/skus`}>
          创建 SKU / 设置价格库存
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
        <p className="text-xs font-black text-[#697386]">库存状态</p>
        <h2 className="mt-1 text-xl font-black">{product.name}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[720px] w-full text-left text-xs">
            <thead className="text-[#697386]">
              <tr className="border-b border-[#d8dde5]">
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3">规格</th>
                <th className="py-2 pr-3">总库存</th>
                <th className="py-2 pr-3">锁定</th>
                <th className="py-2 pr-3">可售</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e6eaf0]">
              {product.skus.map((sku) => (
                <tr key={sku.id}>
                  <td className="py-3 pr-3">
                    <button className="font-black underline underline-offset-4" onClick={() => setActiveSkuId(sku.id)} type="button">{sku.skuCode}</button>
                  </td>
                  <td className="py-3 pr-3 font-bold">{sku.color} / {sku.size}</td>
                  <td className="py-3 pr-3 font-black">{sku.stockQuantity}</td>
                  <td className="py-3 pr-3 font-bold">{sku.reservedQuantity}</td>
                  <td className="py-3 pr-3 font-black">{sku.status === "ACTIVE" ? Math.max(0,sku.stockQuantity - sku.reservedQuantity) : "隐藏"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <form className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4" onSubmit={e=>guard(submitInventory)(e)}>
        <p className="text-xs font-black text-[#697386]">库存调整</p><Link className="underline text-sm" href={"/admin/inventory/logs?productId="+product.id+"&skuId="+(selectedSku?.id||"")}>查看此规格的真实库存流水与操作人</Link>
        <h2 className="text-base font-black">{selectedSku ? selectedSku.skuCode : "暂无 SKU"}</h2>
        <SkuSelect name="skuId" onChange={setActiveSkuId} skus={product.skus} value={selectedSku?.id ?? ""} />
        <label className="vk-field">
          调整方式
          <select name="action" value={adjustment} onChange={e=>setAdjustment(e.target.value)}>
            <option value="RESTOCK">到货入库：在现有库存上增加</option>
            <option value="ADJUST">盘点修正：直接改为填写数量（可清零）</option><option value="DAMAGE">报损：从现有库存扣减</option>
          </select>
        </label>
        <label className="vk-field">数量<input name="quantity" type="number" min={adjustment === "ADJUST" ? 0 : 1} step="1" required value={quantityInput} onChange={e=>setQuantityInput(e.target.value)} /></label><p className="text-sm">库存 {selectedSku?.stockQuantity ?? 0} → {quantityInput === "" ? "—" : adjustment === "ADJUST" ? Number(quantityInput) : (selectedSku?.stockQuantity ?? 0) + (adjustment === "RESTOCK" ? 1 : -1) * Number(quantityInput)}；订单锁定 {selectedSku?.reservedQuantity ?? 0}；调整后可用 {quantityInput === "" ? "—" : Math.max(0,(adjustment === "ADJUST" ? Number(quantityInput) : (selectedSku?.stockQuantity ?? 0) + (adjustment === "RESTOCK" ? 1 : -1) * Number(quantityInput))-(selectedSku?.reservedQuantity ?? 0))}</p>
        <Field label="备注" name="note" placeholder="到货入库 / 盘点修正" />
        <button className="vk-button vk-button-dark" disabled={busy || !selectedSku} type="submit">更新库存</button>
        <p className={statusClass(status.tone)} role="status">{status.message}</p>
      </form>
    </section>
  );
}

export function ProductImageManager({ assets, product }: { assets: MediaAssetOption[]; product: ProductOption }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: "图片管理用于上传、排序、设主图和删除错误图片；删除操作需要二次确认。",
  });
  const {busy,guard} = useAdminSubmit(setStatus);
  const [uploadImagePreview, setUploadImagePreview] = useState<ImagePreview | null>(null);

  useEffect(() => {
    return () => {
      if (uploadImagePreview?.url) URL.revokeObjectURL(uploadImagePreview.url);
    };
  }, [uploadImagePreview?.url]);

  function handleProductImageChange(event: ChangeEvent<HTMLInputElement>) {
    setUploadImagePreview(readImagePreviewFromInput(event, "产品图", setStatus));
  }

  async function bindMediaAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const assetId = getString(form, "assetId");
    if (!assetId) {
      setStatus({ tone: "error", message: "请先从素材库选择图片。" });
      return;
    }
    const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetId,
        alt: getOptionalString(form, "alt"),
        sortOrder: getOptionalInt(form, "sortOrder"),
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus({ tone: "error", message: formatAdminError(result.error, response.status) });
      return;
    }
    setStatus({ tone: "success", message: "素材库图片已绑定到商品。下一步：核对主图和排序。" });
    router.refresh();
  }

  async function submitProductImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("确认上传并绑定这张产品图？")) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}/images`, {
      method: "POST",
      body: form,
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus({ tone: "error", message: formatAdminError(result.error, response.status) });
      return;
    }
    formElement.reset();
    setUploadImagePreview(null);
    setStatus({ tone: "success", message: "产品图已上传。下一步：核对主图、排序和前台展示。" });
    router.refresh();
  }

  async function submitProductImageUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const imageId = getString(form, "imageId");
    const result = await submitJson(
      "PATCH",
      `/api/admin/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(imageId)}`,
      {
        alt: getOptionalString(form, "alt"),
        sortOrder: getOptionalInt(form, "sortOrder"),
      },
      setStatus,
    );
    if (result?.ok) {
      setStatus({ tone: "success", message: "图片信息已保存。下一步：核对图片顺序。" });
      router.refresh();
    }
  }

  async function submitProductImagePrimary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("确认把这张图片设为主图？前台商品卡片会优先使用它。")) return;
    const form = new FormData(event.currentTarget);
    const imageId = getString(form, "imageId");
    const result = await submitJson(
      "PATCH",
      `/api/admin/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(imageId)}`,
      { makePrimary: true },
      setStatus,
    );
    if (result?.ok) {
      setStatus({ tone: "success", message: "主图已更新。下一步：查看前台商品页。" });
      router.refresh();
    }
  }

  async function submitProductImageDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("确认删除这张产品图？删除后后台和前台都不会再使用这条图片记录。")) return;
    const form = new FormData(event.currentTarget);
    const imageId = getString(form, "imageId");
    const result = await submitJson(
      "DELETE",
      `/api/admin/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(imageId)}`,
      {},
      setStatus,
    );
    if (result?.ok) {
      setStatus({ tone: "success", message: "产品图已删除。下一步：核对是否仍有主图。" });
      router.refresh();
    }
  }

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]" id="product-images">
      <div className="grid content-start gap-4">
      <form className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-white p-4" onSubmit={e=>guard(bindMediaAsset)(e)}>
        <p className="text-xs font-black text-[#697386]">统一素材库</p>
        <h2 className="text-base font-black">从素材库选择</h2>
        <label className="vk-field">图片素材<select name="assetId" required defaultValue=""><option value="" disabled>选择已上传素材</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
        <Field defaultValue={product.name} label="图片说明" name="alt" placeholder="商品正面图 / 细节图" />
        <Field defaultValue={String((product.images?.length ?? 0) * 10)} label="排序" name="sortOrder" placeholder="0" type="number" />
        <button className="vk-button vk-button-dark" type="submit" disabled={busy}>绑定到商品</button>
      </form>
      <form className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4" encType="multipart/form-data" onSubmit={e=>guard(submitProductImage)(e)}>
        <p className="text-xs font-black text-[#697386]">新增素材</p>
        <h2 className="text-base font-black">上传到素材库并绑定</h2>
        <label className="vk-field">
          图片文件
          <input accept={adminImageAccept} name="file" onChange={handleProductImageChange} required type="file" />
        </label>
        <div data-admin-product-image-preview="true">
          {uploadImagePreview ? (
            <div className="grid gap-2 rounded-[8px] bg-white p-3">
              <Image
                alt="产品图预览"
                className="aspect-[4/3] w-full rounded-[8px] border border-[#d8dde5] object-cover"
                height={240}
                src={uploadImagePreview.url}
                unoptimized
                width={320}
              />
              <p className="break-all text-xs font-black text-[#697386]">产品图预览：{uploadImagePreview.name} / {uploadImagePreview.sizeLabel}</p>
            </div>
          ) : (
            <p className="rounded-[8px] bg-white px-3 py-3 text-xs font-bold leading-5 text-[#697386]">选择图片后先预览，确认无误再上传。</p>
          )}
        </div>
        <Field defaultValue={product.name} label="图片说明" name="alt" placeholder="商品正面图 / 细节图" />
        <Field defaultValue={String((product.images?.length ?? 0) * 10)} label="排序" name="sortOrder" placeholder="0" type="number" />
        <button className="vk-button vk-button-light" type="submit" disabled={busy}>上传并绑定</button>
      </form>
      </div>

      <div className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
        <p className="text-xs font-black text-[#697386]">图片管理</p>
        <h2 className="mt-1 text-xl font-black">当前图片</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(product.images ?? []).map((image) =>
            image.imageUrl ? (
              <div className="grid gap-3 rounded-[8px] bg-[#f4f6f8] p-3" key={image.id ?? image.imageUrl}>
                <a className="block" href={image.imageUrl} rel="noreferrer" target="_blank">
                  <Image
                    alt={image.alt ?? product.name}
                    className="aspect-[4/3] w-full rounded-[8px] border border-[#d8dde5] object-cover"
                    height={240}
                    src={image.imageUrl}
                    width={320}
                  />
                </a>
                <p className="break-all text-[11px] font-bold text-[#697386]">{image.imageUrl}</p>
                <form className="grid gap-2" onSubmit={e=>guard(submitProductImageUpdate)(e)}>
                  <input name="imageId" type="hidden" value={image.id ?? ""} />
                  <Field defaultValue={image.alt ?? ""} label="图片说明" name="alt" placeholder="商品正面图 / 细节图" />
                  <Field defaultValue={String(image.sortOrder ?? 0)} label="排序" name="sortOrder" placeholder="0" type="number" />
                  <button className="vk-button vk-button-light h-10 min-h-10" disabled={!image.id} type="submit">保存图片信息</button>
                </form>
                <div className="grid grid-cols-2 gap-2">
                  <form onSubmit={e=>guard(submitProductImagePrimary)(e)}>
                    <input name="imageId" type="hidden" value={image.id ?? ""} />
                    <button className="vk-button vk-button-dark h-10 min-h-10 w-full" disabled={!image.id} type="submit">设为主图</button>
                  </form>
                  <form onSubmit={e=>guard(submitProductImageDelete)(e)}>
                    <input name="imageId" type="hidden" value={image.id ?? ""} />
                    <button className="vk-button vk-button-light h-10 min-h-10 w-full" disabled={!image.id} type="submit">删除图片</button>
                  </form>
                </div>
              </div>
            ) : null,
          )}
          {!product.images?.length ? <p className="text-xs font-bold text-[#697386]">暂无产品图，上传第一张后会作为前台主图。</p> : null}
        </div>
      </div>
      <p className={`${statusClass(status.tone)} lg:col-span-2`} role="status">{status.message}</p>
    </section>
  );
}

function SkuSelect({
  name,
  onChange,
  skus,
  value,
}: {
  name: string;
  onChange: (skuId: string) => void;
  skus: SkuOption[];
  value: string;
}) {
  return (
    <label className="vk-field">
      SKU
      <select name={name} onChange={(event) => onChange(event.target.value)} value={value} disabled={!skus.length}>
        {skus.map((sku) => (
          <option key={sku.id} value={sku.id}>
            {sku.skuCode} - {sku.color}/{sku.size} - {formatMoney(sku.priceCents)} - 可售 {sku.stockQuantity - sku.reservedQuantity}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusSelect({ defaultValue = "ACTIVE" }: { defaultValue?: string }) {
  return (
    <label className="vk-field">
      状态
      <select name="status" defaultValue={defaultValue}>
        <option value="ACTIVE">{formatStatusLabel("ACTIVE")}</option>
        <option value="HIDDEN">{formatStatusLabel("HIDDEN")}</option>
      </select>
    </label>
  );
}

function Field({
  defaultValue,
  disabled = false,
  label,
  name,
  placeholder,
  required = false,
  step,
  type = "text",
}: {
  defaultValue?: string;
  disabled?: boolean;
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
  step?: string;
  type?: string;
}) {
  return (
    <label className="vk-field">
      {label}
      <input
        defaultValue={defaultValue}
        disabled={disabled}
        min={type === "number" ? 0 : undefined}
        name={name}
        placeholder={placeholder}
        required={required}
        step={step}
        type={type}
      />
    </label>
  );
}

function readImagePreviewFromInput(event: ChangeEvent<HTMLInputElement>, label: string, setStatus: (status: Status) => void) {
  const file = event.currentTarget.files?.[0];
  if (!file) return null;
  if (!adminImageAccept.split(",").includes(file.type)) {
    event.currentTarget.value = "";
    setStatus({ tone: "error", message: `${label}只支持 JPG、PNG、WebP 或 AVIF 图片。` });
    return null;
  }
  if (file.size <= 0 || file.size > maxAdminImageBytes) {
    event.currentTarget.value = "";
    setStatus({ tone: "error", message: `${label}文件不能超过 5MB。` });
    return null;
  }
  return {
    name: file.name,
    sizeLabel: formatFileSize(file.size),
    url: URL.createObjectURL(file),
  };
}

async function submitJson(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  payload: Record<string, unknown>,
  setStatus: (status: Status) => void,
) {
  try {
    setStatus({ tone: "idle", message: "正在提交..." });
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stripEmpty(payload)),
    });
    const result = (await response.json().catch(() => ({}))) as AdminMutationResult;
    if (!response.ok || !result.ok) {
      setStatus({ tone: "error", message: formatAdminError(result.error, response.status) });
      return result;
    }
    return result;
  } catch (error) {
    setStatus({ tone: "error", message: getSafeValidationMessage(error) });
    return { ok: false };
  }
}

function getString(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  if (!value) throw new Error(`${name} 不能为空`);
  return value;
}

function getOptionalString(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

function getInt(form: FormData, name: string) {
  const value = Number(form.get(name));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`);
  return value;
}

function getOptionalInt(form: FormData, name: string) {
  const raw = String(form.get(name) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`);
  return value;
}

function getNullableIsoDate(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} 不是有效时间`);
  return date.toISOString();
}

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function getMoneyCents(form: FormData, name: string) {
  const raw = String(form.get(name) ?? "").trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} 必须是有效金额`);
  return Math.round(value * 100);
}

function stripEmpty(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""));
}

function isProductResult(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

function statusClass(tone: Status["tone"]) {
  if (tone === "success") return "rounded-[8px] bg-foreground px-4 py-3 text-sm font-black text-background";
  if (tone === "error") return "rounded-[8px] border border-foreground px-4 py-3 text-sm font-black text-foreground";
  return "rounded-[8px] bg-[#eef1f5] px-4 py-3 text-sm font-black text-muted";
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    style: "currency",
  }).format(cents / 100);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatAdminError(error: string | undefined, status: number) {
  const messages: Record<string, string> = {
    ADMIN_UNAUTHORIZED: "后台登录已失效，请重新登录。",
    INVALID_PRODUCT_REQUEST: "商品资料不完整，请检查必填项。",
    INVALID_PRODUCT_UPDATE: "商品资料更新内容不合法。",
    INVALID_SKU_REQUEST: "SKU 资料不完整，请检查必填项。",
    INVALID_SKU_UPDATE: "SKU 更新内容不合法。",
    INVALID_INVENTORY_REQUEST: "库存调整内容不合法。",
    PRODUCT_IMAGE_FILE_REQUIRED: "请选择要上传的产品图。",
    UNSUPPORTED_PRODUCT_IMAGE_TYPE: "只支持 JPG、PNG、WebP 或 AVIF 图片。",
    PRODUCT_IMAGE_TOO_LARGE: "产品图不能超过 5MB。",
    PRODUCT_IMAGE_UPLOAD_FAILED: "产品图上传失败，请稍后重试。",
    PRODUCT_IMAGE_UPDATE_FAILED: "产品图更新失败，请稍后重试。",
    PRODUCT_IMAGE_DELETE_FAILED: "产品图删除失败，请稍后重试。",
    PRODUCT_IMAGE_NOT_FOUND: "产品图不存在或已被删除。",
    PRODUCT_ALREADY_EXISTS: "商品路径或编码已存在。",
    PRODUCT_NOT_FOUND: "商品不存在或已被删除。",
    SKU_ALREADY_EXISTS: "SKU 编码已存在。",
    SKU_NOT_FOUND: "SKU 不存在或已被删除。",
    INVALID_INVENTORY_QUANTITY: "库存数量必须大于 0。",
  };
  if (error && messages[error]) return messages[error];
  return formatAdminActionError(error, status, "商品操作");
}

function getSafeValidationMessage(error: unknown) {
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) return error.message;
  return "提交失败，请检查填写内容和网络连接后重试。";
}
