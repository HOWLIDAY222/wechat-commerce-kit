"use client";

import { useRef } from "react";
import { useAdminSubmit } from "@/lib/client/use-admin-submit";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { CheckCircle2, ImagePlus, Save, Send } from "lucide-react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
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

type AdminMutationResult = {
  ok?: boolean;
  error?: string;
  product?: unknown;
  definitiveFailure?: boolean;
};

export function ProductCreateForm() {
  const router = useRouter();
  const requestId=useRef<string|null>(null);
  const fingerprint=useRef("");
  const [status, setStatus] = useState<Status>({
    tone: "idle",
    message: "新商品会先保存为草稿；补齐图片、可售 SKU、价格和库存后才能上架。",
  });
  const {busy,guard}=useAdminSubmit(setStatus);
  const [firstImagePreview, setFirstImagePreview] = useState<ImagePreview | null>(null);
  useEffect(() => {
    return () => {
      if (firstImagePreview?.url) URL.revokeObjectURL(firstImagePreview.url);
    };
  }, [firstImagePreview?.url]);

  function handleFirstImageChange(event: ChangeEvent<HTMLInputElement>) {
    setFirstImagePreview(readImagePreviewFromInput(event, "首张商品图", setStatus));
  }

  async function submitProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submitter = (event.nativeEvent as { submitter?: HTMLElement }).submitter;
    const intent = submitter instanceof HTMLButtonElement && submitter.value === "draft" ? "draft" : "continue";
    if (!window.confirm(intent === "draft" ? "确认保存商品草稿？" : "确认创建商品并继续完善？")) return;

    const form = new FormData(formElement);
    const firstImage = form.get("firstImage");
    const priceCents=getOptionalMoneyCents(form,"pricePreview");
    const stockQuantity=getOptionalInt(form,"stockPreview")??0;
    const color=getOptionalString(form,"color"),size=getOptionalString(form,"size");
    if((priceCents!==undefined||stockQuantity>0||color||size)&&(!color||!size))throw Error("填写价格或库存时，请同时填写颜色和尺码，以便完整保存规格。");
    const currentFingerprint=JSON.stringify(Array.from(form.entries()).map(([k,v])=>[k,typeof v==="string"?v:{name:v.name,size:v.size}]));
    if(requestId.current && fingerprint.current!==currentFingerprint)throw Error("上次创建结果尚未确认。请先到商品列表按编码核对，避免重复创建或漏存修改。");
    requestId.current??=crypto.randomUUID();fingerprint.current=currentFingerprint;
    const result = await submitJson(
      "POST",
      "/api/admin/products",
      {
        requestId:requestId.current,
        initialSku: color&&size ? {skuCode:getString(form,"code")+"-"+size,color,size,priceCents:priceCents??0,stockQuantity,status:"HIDDEN"}:undefined,
        code: getString(form, "code"),
        name: getString(form, "name"),
        category: getString(form, "category"),
        scene: getOptionalString(form, "scene"),
        summary: getOptionalString(form, "summary")??"",
        description: getOptionalString(form, "description"),
        silhouette: getOptionalString(form, "silhouette"),
        rise: getOptionalString(form, "rise"),
        coverage: getOptionalString(form, "coverage"),
        supportLevel: getOptionalString(form, "supportLevel"),
        fabricComposition: getOptionalString(form, "fabricComposition"),
        features: parseProductFeatures(getOptionalString(form, "features")??""),
        fitNote: getOptionalString(form, "fitNote"),
        careInstructions: getOptionalString(form, "careInstructions"),
        packSize: getOptionalInt(form, "packSize"),
        status: "HIDDEN",
        sortOrder: getOptionalInt(form, "sortOrder"),
      },
      setStatus,
    );
    if (!isProductResult(result?.product)) { if(result?.definitiveFailure)requestId.current=null; return; }

    if (firstImage instanceof File && firstImage.size > 0) {
      setStatus({ tone: "idle", message: "商品已创建，正在绑定首张商品图..." });
      const imageForm = new FormData();
      imageForm.append("file", firstImage);
      imageForm.append("alt", getOptionalString(form, "firstImageAlt") ?? getString(form, "name"));
      imageForm.append("sortOrder", "0");
      try {
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
      } catch { setStatus({tone:"error",message:"商品草稿已保存，图片结果尚未确认。请在图片管理中核对后补充。"});router.replace('/admin/products/'+encodeURIComponent(result.product.id)+'/images');router.refresh();return; }
    }

    requestId.current=null;
    formElement.reset();
    setFirstImagePreview(null);
    setStatus({
      tone: "success",
      message: intent === "draft"
        ? "商品草稿已保存。下一步补齐主图、SKU、价格、库存和详情。"
        : priceCents && priceCents > 0
          ? "商品草稿已创建，并已生成所填规格。请继续检查图片、价格和库存。"
          : "商品草稿已创建。请继续补齐图片、SKU、价格和库存。",
    });
    router.replace(`/admin/products/${encodeURIComponent(result.product.id)}/images`);
    router.refresh();
  }

  return (
    <section className="grid gap-4 pb-24 xl:grid-cols-[minmax(0,1fr)_250px]">
      <form className="grid gap-4" id="admin-product-create-form" onSubmit={e=>guard(submitProduct)(e)}>
        <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eef4ff] text-brand"><CheckCircle2 className="h-5 w-5" /></span>
            <div><p className="text-sm font-black">先建立商品草稿</p><p className="mt-1 text-xs font-bold text-[#697386]">访问地址由商品编码自动生成，上架动作在资料完整后执行。</p></div>
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
            <SectionTitle required title="1. 商品主图 / 3:4 主图 / 主图视频" />
            <div className="mt-4 grid gap-3">
              <label className="grid min-h-[136px] cursor-pointer place-items-center rounded-[8px] border border-dashed border-[#cfd6df] bg-[#f8fafc] px-4 py-4 text-center">
                <input accept={adminImageAccept} className="sr-only" name="firstImage" onChange={handleFirstImageChange} type="file" />
                {firstImagePreview ? (
                  <span className="grid gap-2">
                    <Image alt="首图预览" className="aspect-[4/3] w-full max-w-[280px] rounded-[8px] object-cover" height={210} src={firstImagePreview.url} unoptimized width={280} />
                    <span className="text-xs font-black text-[#697386]">{firstImagePreview.name} / {firstImagePreview.sizeLabel}</span>
                  </span>
                ) : (
                  <span className="grid justify-items-center gap-2 text-xs font-bold text-[#697386]">
                    <ImagePlus className="h-8 w-8 text-[#155eef]" />
                    添加图片，支持 JPG / PNG / WebP / AVIF，最大 5MB
                  </span>
                )}
              </label>
              <Field label="首图说明" name="firstImageAlt" placeholder="商品正面图 / 细节图" />
            </div>
          </section>

          <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
            <SectionTitle required title="2. 商品标题 & 类目" />
            <div className="mt-4 grid gap-3">
              <Field label="商品标题" maxLength={60} name="name" placeholder="MerchantKit 新商品" required />
              <Field label="商品类目" name="category" placeholder="服装 / 男装 / T 恤" required />
              <Field label="商品编码" name="code" placeholder="VK-NEW" required />
              <Field label="使用场景" name="scene" placeholder="训练 / 通勤 / 日常" />
              <Field label="排序" name="sortOrder" placeholder="100" type="number" />
            </div>
          </section>

          <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
            <SectionTitle required title="3. 穿着与面料信息" />
            <p className="mt-3 text-xs font-bold leading-5 text-[#697386]">只填写已经由实物、样衣单或供应商资料确认的信息；未确认项目留空，不会显示在前台。</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="版型" name="silhouette" placeholder="三角 / 平角 / 四角" />
              <Field label="腰位" name="rise" placeholder="低腰 / 中腰 / 高腰" />
              <Field label="包裹度" name="coverage" placeholder="例如：后片适中包裹" />
              <Field label="支撑感" name="supportLevel" placeholder="例如：轻度支撑" />
              <Field label="面料成分" name="fabricComposition" placeholder="按水洗标填写完整成分及比例" />
              <Field label="包装数量" min={1} name="packSize" placeholder="1" type="number" />
              <Field className="md:col-span-2" label="功能特点" name="features" placeholder="用逗号分隔，例如：局部网眼拼接，弹力腰带" />
              <Field className="md:col-span-2" label="贴合说明" name="fitNote" placeholder="说明贴合程度、腿口和腰带感受" />
              <Field className="md:col-span-2" label="洗护方式" name="careInstructions" placeholder="按水洗标填写洗涤、漂白、熨烫和干燥要求" />
            </div>
          </section>

          <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
            <SectionTitle required title="4. 商品规格 / SKU" />
            <div className="mt-4 grid gap-3"><Field label="颜色" name="color" placeholder="白色" /><Field label="尺码" name="size" placeholder="S / M / L" /><p className="text-xs">规格、价格和库存随草稿一起保存；更多尺码可在保存后添加。</p>            </div>
          </section>

          <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
            <SectionTitle required title="5. 价格 & 库存" />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="售卖价（元）" name="pricePreview" placeholder="59.00" />
              <Field label="初始库存" name="stockPreview" placeholder="100" type="number" />
            </div>
            <p className="mt-3 rounded-[8px] bg-[#f8fafc] px-3 py-3 text-xs font-bold leading-5 text-[#697386]">已填写的规格、价格与库存会与商品资料一起保存。草稿规格默认隐藏，核对完整后再启用。</p>
          </section>

          <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
            <SectionTitle required title="6. 商品详情" />
            <label className="vk-field mt-4">
              商品摘要
              <textarea name="summary" placeholder="给顾客看的卖点摘要" />
            </label>
            <label className="vk-field mt-3">
              详情说明
              <textarea name="description" placeholder="面向顾客说明版型、结构和可确认的商品信息" />
            </label>
          </section>

          <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)] lg:col-span-2">
            <SectionTitle required title="7. 发布检查" />
            <p className="mt-4 rounded-[8px] bg-[#f4f6f8] px-4 py-3 text-sm font-bold leading-6 text-[#475467]">商品创建后保持草稿。设为公开前，系统会校验消费者摘要、详情说明、商品图、启用 SKU 和有效价格；预售或现货还必须有可用库存。配送费用由运营设置统一维护，售后与发货承诺以已发布政策为准。</p>
          </section>
        </div>

        <p className={statusClass(status.tone)} role="status">{status.message}</p>
      </form>

      <aside className="grid gap-4 xl:sticky xl:top-[112px] xl:self-start">
        <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
          <h3 className="text-base font-black text-[#101828]">当前状态</h3>
          <p className="mt-3 rounded-[8px] bg-[#eef4ff] px-3 py-3 text-sm font-black text-[#155eef]">待创建商品草稿</p>
        </section>
        <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
          <h3 className="text-base font-black text-[#101828]">上架条件</h3>
          <div className="mt-3 grid gap-2 text-xs font-bold leading-5 text-[#697386]"><p>至少一张商品图</p><p>至少一个启用的可售 SKU</p><p>售价大于 0 且可用库存大于 0</p></div>
        </section>
        <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
          <h3 className="text-base font-black text-[#101828]">发布小贴士</h3>
          <ul className="mt-3 grid gap-2 text-xs font-bold leading-5 text-[#697386]">
            <li>主图建议白底，尺寸 3:4，清晰完整。</li>
            <li>准确填写属性与规格，提升转化率。</li>
            <li>合理设置价格与库存，避免超卖。</li>
          </ul>
        </section>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8dde5] bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-2 items-center gap-2 sm:grid-cols-[1fr_180px_200px]">
          <p className="hidden items-center gap-2 text-xs font-black text-[#079455] sm:flex">
            <CheckCircle2 className="h-4 w-4" />
            创建后进入图片与 SKU 管理
          </p>
          <button className="vk-button vk-button-light min-h-12 gap-2 px-3 text-sm" form="admin-product-create-form" name="intent" type="submit" disabled={busy} value="draft">
            <Save className="h-4 w-4" />
            保存草稿
          </button>
          <button className="vk-button vk-button-dark min-h-12 gap-2 px-3 text-sm" form="admin-product-create-form" name="intent" type="submit" disabled={busy} value="continue">
            <Send className="h-4 w-4" />
            创建并继续完善
          </button>
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ action, required, title }: { action?: string; required?: boolean; title: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-black text-[#101828]">{title}</h3>
        {required ? <span className="text-sm font-black text-[#d92d20]">*</span> : null}
      </div>
      {action ? <span className="text-xs font-black text-[#155eef]">{action}</span> : null}
    </div>
  );
}

function Field({
  className = "",
  label,
  maxLength,
  min,
  name,
  placeholder,
  required = false,
  type = "text",
}: {
  className?: string;
  label: string;
  maxLength?: number;
  min?: number;
  name: string;
  placeholder: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className={`vk-field ${className}`}>
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        {maxLength ? <span className="text-xs font-bold text-[#98a2b3]">{maxLength}</span> : null}
      </span>
      <input min={type === "number" ? (min ?? 0) : undefined} name={name} placeholder={placeholder} required={required} type={type} />
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
      return {...result,definitiveFailure:response.status>=400&&response.status<500};
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

function getOptionalInt(form: FormData, name: string) {
  const raw = String(form.get(name) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} 必须是非负整数`);
  return value;
}

function getOptionalMoneyCents(form: FormData, name: string) {
  const raw = getOptionalString(form, name);
  if (!raw) return undefined;
  const normalized = raw.replace(/[￥¥,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw Error("售价必须为非负金额，最多两位小数");
  return Math.round(Number(normalized) * 100);
}

function stripEmpty(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""));
}

function isProductResult(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

function statusClass(tone: Status["tone"]) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#027a48]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#d92d20]";
  return "rounded-[8px] bg-[#eef4ff] px-4 py-3 text-sm font-black text-[#155eef]";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatAdminError(error: string | undefined, status: number) {
  const messages: Record<string, string> = {
    ADMIN_UNAUTHORIZED: "后台登录已失效，请重新登录。",
    INVALID_PRODUCT_REQUEST: "商品资料不完整，请检查必填项。",
    PRODUCT_ALREADY_EXISTS: "商品路径或编码已存在。",
    PRODUCT_IMAGE_FILE_REQUIRED: "请选择要上传的商品图。",
    UNSUPPORTED_PRODUCT_IMAGE_TYPE: "只支持 JPG、PNG、WebP 或 AVIF 图片。",
    PRODUCT_IMAGE_TOO_LARGE: "商品图不能超过 5MB。",
    PRODUCT_IMAGE_UPLOAD_FAILED: "商品图上传失败，请稍后重试。",
  };
  if (error && messages[error]) return messages[error];
  return formatAdminActionError(error, status, "商品创建");
}

function getSafeValidationMessage(error: unknown) {
  if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) return error.message;
  return "提交失败，请检查填写内容和网络连接后重试。";
}
