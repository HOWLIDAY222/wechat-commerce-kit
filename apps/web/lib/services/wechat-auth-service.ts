import {productStylePrice} from "@/lib/commerce/product-style";
import { mergeMembership } from "@/lib/services/membership-service";
import { mergeFitProfiles } from "@/lib/services/fit-profile-service";
import {mergeGifts} from '@/lib/services/gift-card-service';
import { appConfig } from "@/lib/config";
import { calculateCartPricing } from "@/lib/commerce/quantity-pricing";
import { prisma } from "@/lib/db/prisma";
import type { SessionRole } from "@/lib/auth/session";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";

type WeChatIdentityInput = {
  appId: string;
  openId: string;
  unionId?: string;
};

export async function resolveWeChatUser(input: WeChatIdentityInput) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    throw new Error("MINIPROGRAM_AUTH_REQUIRES_PRISMA");
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await resolveWeChatUserOnce(input);
    } catch (error) {
      if (attempt < 3 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }

  throw new Error("WECHAT_IDENTITY_TRANSACTION_RETRY_EXHAUSTED");
}

export async function getWeChatOpenIdForUser(userId: string, appId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return null;
  const identity = await prisma.weChatIdentity.findUnique({
    where: { userId_appId: { userId, appId } },
    select: { openId: true },
  });
  return identity?.openId ?? null;
}

export async function linkWeChatUserToPhone(sourceUserId: string, phone: string, options: { requireUnbound?: boolean } = {}) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("MINIPROGRAM_AUTH_REQUIRES_PRISMA");
  const normalizedPhone = normalizeMainlandPhone(phone);
  if (!isMainlandPhone(normalizedPhone)) throw new Error("INVALID_PHONE");
  const appId = appConfig.WECHAT_MINIPROGRAM_APP_ID;
  if (!appId) throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const source = await tx.user.findUnique({
          where: { id: sourceUserId },
          include: { wechatIdentities: true },
        });
        if (!source || !source.wechatIdentities.some((identity) => identity.appId === appId)) {
          throw new Error("WECHAT_IDENTITY_NOT_FOUND");
        }
        assertActiveUser(source.status);
        if (source.role !== "CUSTOMER") throw new Error("WECHAT_ACCOUNT_LINK_ROLE_FORBIDDEN");
        if (options.requireUnbound && source.phone) throw new Error("WECHAT_PHONE_ALREADY_LINKED");

        const target = await tx.user.findUnique({ where: { phone: normalizedPhone } });
        if (!target || target.id === source.id) {
          const user = await tx.user.update({
            where: { id: source.id },
            data: { phone: normalizedPhone, lastLoginAt: new Date() },
            select: userSelect,
          });
          await tx.auditLog.create({
            data: {
              actorId: source.id,
              actorType: "user",
              action: "wechat_identity.phone_linked",
              targetType: "user",
              targetId: source.id,
              detail: { appId, merged: false },
            },
          });
          return toResolvedUser(user);
        }

        assertActiveUser(target.status);
        if (target.role !== "CUSTOMER") throw new Error("WECHAT_ACCOUNT_LINK_ROLE_FORBIDDEN");
        const targetIdentityConflict = await tx.weChatIdentity.findFirst({
          where: {
            userId: target.id,
            appId: { in: source.wechatIdentities.map((identity) => identity.appId) },
          },
          select: { id: true },
        });
        if (targetIdentityConflict) throw new Error("WECHAT_APP_IDENTITY_CONFLICT");
        await mergeCustomerData(tx, source.id, target.id);
        await tx.user.update({
          where: { id: source.id },
          data: { status: "DISABLED", name: `已合并微信账户 ${source.id.slice(-6)}` },
        });
        const user = await tx.user.update({
          where: { id: target.id },
          data: { lastLoginAt: new Date() },
          select: userSelect,
        });
        await tx.auditLog.create({
          data: {
            actorId: target.id,
            actorType: "user",
            action: "wechat_identity.account_merged",
            targetType: "user",
            targetId: target.id,
            detail: { appId, sourceUserId: source.id },
          },
        });
        return toResolvedUser(user);
      }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });
    } catch (error) {
      if (attempt < 3 && isRetryableTransactionError(error)) continue;
      throw error;
    }
  }
  throw new Error("WECHAT_ACCOUNT_LINK_RETRY_EXHAUSTED");
}

async function mergeCustomerData(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], sourceUserId: string, targetUserId: string) {
  const [sourceCart, targetCart, sourceFavorites, targetDefaultAddress] = await Promise.all([
    tx.cart.findUnique({ where: { userId: sourceUserId }, include: { items: { include: { sku: { include: { product: true } } } } } }),
    tx.cart.findUnique({ where: { userId: targetUserId }, include: { items: { include: { sku: { include: { product: true } } } } } }),
    tx.favorite.findMany({ where: { userId: sourceUserId }, select: { productId: true } }),
    tx.address.findFirst({ where: { userId: targetUserId, isDefault: true }, select: { id: true } }),
  ]);

  if (sourceCart && targetCart) {
    try {
      const combined = [...sourceCart.items, ...targetCart.items];
      for (const item of combined) {
        const sharedQuantity = combined.filter(line => line.skuId === item.skuId).reduce((sum, line) => sum + line.quantity, 0);
        if (sharedQuantity > item.sku.stockQuantity - item.sku.reservedQuantity) throw new Error("INSUFFICIENT_INVENTORY");
      }
      calculateCartPricing([...sourceCart.items, ...targetCart.items].map(item => ({
        id: item.id, productId: item.sku.productId, product: item.sku.product,
        quantity: item.quantity, style:item.style,unitPriceCents: productStylePrice(item.sku.product.quantityPricing,item.style,item.sku.priceCents),
      })));
    } catch {
      throw new Error("ACCOUNT_MERGE_CART_LIMIT_EXCEEDED");
    }
    for (const item of sourceCart.items) {
      await tx.cartItem.upsert({
        where: { cartId_skuId_style: { cartId: targetCart.id, skuId: item.skuId,style:item.style } },
        create: { cartId: targetCart.id, skuId: item.skuId,style:item.style,quantity: item.quantity, unitPriceCents: item.unitPriceCents },
        update: { quantity: { increment: item.quantity }, unitPriceCents: item.unitPriceCents },
      });
    }
    await tx.cart.delete({ where: { id: sourceCart.id } });
  } else if (sourceCart) {
    await tx.cart.update({ where: { id: sourceCart.id }, data: { userId: targetUserId } });
  }

  for (const favorite of sourceFavorites) {
    await tx.favorite.upsert({
      where: { userId_productId: { userId: targetUserId, productId: favorite.productId } },
      create: { userId: targetUserId, productId: favorite.productId },
      update: {},
    });
  }
  await tx.favorite.deleteMany({ where: { userId: sourceUserId } });
  if (targetDefaultAddress) await tx.address.updateMany({ where: { userId: sourceUserId }, data: { isDefault: false } });
  await tx.address.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await mergeMembership(tx, sourceUserId, targetUserId);
  await mergeFitProfiles(tx, sourceUserId, targetUserId);
  await mergeGifts(tx,sourceUserId,targetUserId);
  await tx.order.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.afterSalesRequest.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.weChatIdentity.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.smsCode.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.loginLog.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.miniProgramCartImport.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.privacyConsent.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  await tx.session.deleteMany({ where: { userId: sourceUserId } });
}

async function resolveWeChatUserOnce(input: WeChatIdentityInput) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const existing = await tx.weChatIdentity.findUnique({
      where: { appId_openId: { appId: input.appId, openId: input.openId } },
      include: { user: true },
    });

    if (existing) {
      assertActiveUser(existing.user.status);
      if (input.unionId && existing.unionId && existing.unionId !== input.unionId) {
        throw new Error("WECHAT_UNION_ID_MISMATCH");
      }
      if (input.unionId) {
        const conflictingIdentity = await tx.weChatIdentity.findFirst({
          where: { unionId: input.unionId, userId: { not: existing.userId } },
          select: { id: true },
        });
        if (conflictingIdentity) throw new Error("WECHAT_UNION_ID_CONFLICT");
      }
      const user = await tx.user.update({
        where: { id: existing.userId },
        data: { lastLoginAt: now },
        select: userSelect,
      });
      await tx.weChatIdentity.update({
        where: { id: existing.id },
        data: {
          lastLoginAt: now,
          ...(input.unionId ? { unionId: input.unionId } : {}),
        },
      });
      return toResolvedUser(user);
    }

    const unionIdentities = input.unionId
      ? await tx.weChatIdentity.findMany({
          where: { unionId: input.unionId },
          include: { user: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const unionUserIds = new Set(unionIdentities.map((identity) => identity.userId));
    if (unionUserIds.size > 1) throw new Error("WECHAT_UNION_ID_CONFLICT");
    const unionIdentity = unionIdentities[0] ?? null;
    if (unionIdentity) assertActiveUser(unionIdentity.user.status);
    if (unionIdentity) {
      const sameAppIdentity = await tx.weChatIdentity.findUnique({
        where: { userId_appId: { userId: unionIdentity.userId, appId: input.appId } },
        select: { id: true },
      });
      if (sameAppIdentity) throw new Error("WECHAT_APP_IDENTITY_CONFLICT");
    }

    const user = unionIdentity
      ? await tx.user.update({
          where: { id: unionIdentity.userId },
          data: { lastLoginAt: now },
          select: userSelect,
        })
      : await tx.user.create({
          data: {
            name: "微信用户",
            role: "CUSTOMER",
            status: "ACTIVE",
            lastLoginAt: now,
          },
          select: userSelect,
        });

    await tx.weChatIdentity.create({
      data: {
        appId: input.appId,
        openId: input.openId,
        unionId: input.unionId,
        userId: user.id,
        lastLoginAt: now,
      },
    });
    return toResolvedUser(user);
  }, {
    isolationLevel: "Serializable",
    maxWait: 5_000,
    timeout: 15_000,
  });
}

const userSelect = {
  email: true,
  id: true,
  name: true,
  phone: true,
  role: true,
} as const;

function toResolvedUser(user: { email: string | null; id: string; name: string; phone: string | null; role: "CUSTOMER" | "ADMIN" | "OWNER" }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    role: toSessionRole(user.role),
  };
}

function toSessionRole(role: "CUSTOMER" | "ADMIN" | "OWNER"): SessionRole {
  if (role === "OWNER") return "owner";
  if (role === "ADMIN") return "admin";
  return "customer";
}

function assertActiveUser(status: string) {
  if (status !== "ACTIVE") throw new Error("USER_DISABLED");
}

function isRetryableTransactionError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}
