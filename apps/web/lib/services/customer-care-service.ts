import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { getEmailProviderStatus, sendTransactionalEmail } from "@/lib/providers/email";
import { writeRuntimeAudit } from "@/lib/services/admin-ops-service";

type InquiryStatus = "NEW" | "IN_PROGRESS" | "RESOLVED";
type SubscriptionStatus = "ACTIVE" | "UNSUBSCRIBED";

type RuntimeSubscription = {
  id: string;
  email: string;
  status: SubscriptionStatus;
  unsubscribeToken: string;
  source?: string;
  ip?: string;
  userAgent?: string;
  subscribedAt: Date;
  unsubscribedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type RuntimeInquiry = {
  id: string;
  name: string;
  contact: string;
  message: string;
  status: InquiryStatus;
  adminNote?: string;
  assigneeId?: string;
  ip?: string;
  userAgent?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const runtime = globalThis as typeof globalThis & {
  __merchantkitNewsletterSubscriptions?: Map<string, RuntimeSubscription>;
  __merchantkitContactInquiries?: Map<string, RuntimeInquiry>;
};
const runtimeSubscriptions = runtime.__merchantkitNewsletterSubscriptions ?? new Map<string, RuntimeSubscription>();
const runtimeInquiries = runtime.__merchantkitContactInquiries ?? new Map<string, RuntimeInquiry>();
runtime.__merchantkitNewsletterSubscriptions = runtimeSubscriptions;
runtime.__merchantkitContactInquiries = runtimeInquiries;

export async function subscribeToNewsletter(input: {
  email: string;
  source?: string;
  ip?: string;
  userAgent?: string;
}) {
  const email = normalizeEmail(input.email);
  const now = new Date();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const existing = runtimeSubscriptions.get(email);
    const subscription: RuntimeSubscription = existing
      ? {
          ...existing,
          status: "ACTIVE",
          source: input.source ?? existing.source,
          ip: input.ip,
          userAgent: input.userAgent,
          subscribedAt: existing.status === "ACTIVE" ? existing.subscribedAt : now,
          unsubscribedAt: undefined,
          updatedAt: now,
        }
      : {
          id: `runtime-newsletter-${randomUUID()}`,
          email,
          status: "ACTIVE",
          unsubscribeToken: createUnsubscribeToken(),
          source: input.source,
          ip: input.ip,
          userAgent: input.userAgent,
          subscribedAt: now,
          createdAt: now,
          updatedAt: now,
        };
    runtimeSubscriptions.set(email, subscription);
    writeRuntimeAudit({ actorType: "public", action: existing ? "public.newsletter.reactivated" : "public.newsletter.subscribed", targetType: "newsletter_subscription", targetId: subscription.id, detail: { email, source: input.source } });
    return { subscription, outcome: existing?.status === "ACTIVE" ? "existing" : existing ? "reactivated" : "created" } as const;
  }

  const existing = await prisma.newsletterSubscription.findUnique({ where: { email } });
  if (existing?.status === "ACTIVE") {
    return { subscription: existing, outcome: "existing" } as const;
  }
  const subscription = existing
    ? await prisma.newsletterSubscription.update({
        where: { id: existing.id },
        data: {
          status: "ACTIVE",
          source: input.source ?? existing.source,
          ip: input.ip,
          userAgent: input.userAgent,
          subscribedAt: now,
          unsubscribedAt: null,
          unsubscribeToken: createUnsubscribeToken(),
        },
      })
    : await prisma.newsletterSubscription.create({
        data: {
          email,
          unsubscribeToken: createUnsubscribeToken(),
          source: input.source,
          ip: input.ip,
          userAgent: input.userAgent,
        },
      });
  await prisma.auditLog.create({
    data: {
      actorType: "public",
      action: existing ? "public.newsletter.reactivated" : "public.newsletter.subscribed",
      targetType: "newsletter_subscription",
      targetId: subscription.id,
      detail: toJson({ email, source: input.source }),
      ip: input.ip,
    },
  });
  return { subscription, outcome: existing ? "reactivated" : "created" } as const;
}

export async function unsubscribeFromNewsletter(token: string) {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error("NEWSLETTER_UNSUBSCRIBE_TOKEN_REQUIRED");
  const now = new Date();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const subscription = Array.from(runtimeSubscriptions.values()).find((item) => item.unsubscribeToken === normalizedToken);
    if (!subscription) throw new Error("NEWSLETTER_SUBSCRIPTION_NOT_FOUND");
    subscription.status = "UNSUBSCRIBED";
    subscription.unsubscribedAt = now;
    subscription.updatedAt = now;
    return subscription;
  }
  const subscription = await prisma.newsletterSubscription.findUnique({ where: { unsubscribeToken: normalizedToken } });
  if (!subscription) throw new Error("NEWSLETTER_SUBSCRIPTION_NOT_FOUND");
  if (subscription.status === "UNSUBSCRIBED") return subscription;
  const updated = await prisma.newsletterSubscription.update({
    where: { id: subscription.id },
    data: { status: "UNSUBSCRIBED", unsubscribedAt: now },
  });
  await prisma.auditLog.create({
    data: { actorType: "public", action: "public.newsletter.unsubscribed", targetType: "newsletter_subscription", targetId: updated.id },
  });
  return updated;
}

export async function createContactInquiry(input: {
  name: string;
  contact: string;
  message: string;
  ip?: string;
  userAgent?: string;
}) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const now = new Date();
    const inquiry: RuntimeInquiry = { id: `runtime-inquiry-${randomUUID()}`, status: "NEW", createdAt: now, updatedAt: now, ...input };
    runtimeInquiries.set(inquiry.id, inquiry);
    writeRuntimeAudit({ actorType: "public", action: "public.contact.submitted", targetType: "contact_inquiry", targetId: inquiry.id, detail: { name: input.name, contact: input.contact } });
    return inquiry;
  }
  const inquiry = await prisma.contactInquiry.create({ data: input });
  await prisma.auditLog.create({
    data: {
      actorType: "public",
      action: "public.contact.submitted",
      targetType: "contact_inquiry",
      targetId: inquiry.id,
      detail: toJson({ name: input.name, contact: input.contact }),
      ip: input.ip,
    },
  });
  return inquiry;
}

export async function listCustomerCareOverview() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return {
      inquiries: Array.from(runtimeInquiries.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      subscriptions: Array.from(runtimeSubscriptions.values()).sort((a, b) => b.subscribedAt.getTime() - a.subscribedAt.getTime()),
      campaigns: [],
      emailProvider: getEmailProviderStatus(),
    };
  }
  const [inquiries, subscriptions, campaigns] = await Promise.all([
    prisma.contactInquiry.findMany({ include: { assignee: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.newsletterSubscription.findMany({ orderBy: { subscribedAt: "desc" }, take: 500 }),
    prisma.newsletterCampaign.findMany({ include: { _count: { select: { deliveries: true } } }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { inquiries, subscriptions, campaigns, emailProvider: getEmailProviderStatus() };
}

export async function updateContactInquiry(
  inquiryId: string,
  input: { status: InquiryStatus; adminNote?: string },
  actorId: string,
) {
  const now = new Date();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const inquiry = runtimeInquiries.get(inquiryId);
    if (!inquiry) throw new Error("CONTACT_INQUIRY_NOT_FOUND");
    Object.assign(inquiry, input, { assigneeId: actorId, resolvedAt: input.status === "RESOLVED" ? now : undefined, updatedAt: now });
    writeRuntimeAudit({ actorId, actorType: "admin", action: "admin.contact.updated", targetType: "contact_inquiry", targetId: inquiryId, detail: input });
    return inquiry;
  }
  return prisma.$transaction(async (tx) => {
    const inquiry = await tx.contactInquiry.update({
      where: { id: inquiryId },
      data: {
        status: input.status,
        adminNote: input.adminNote?.trim() || null,
        assigneeId: actorId,
        resolvedAt: input.status === "RESOLVED" ? now : null,
      },
    });
    await tx.auditLog.create({ data: { actorId, actorType: "admin", action: "admin.contact.updated", targetType: "contact_inquiry", targetId: inquiry.id, detail: toJson(input) } });
    return inquiry;
  });
}

export async function sendNewsletterCampaign(input: { subject: string; body: string }, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("NEWSLETTER_CAMPAIGN_REQUIRES_DATABASE");
  if (!getEmailProviderStatus().configured) throw new Error("EMAIL_PROVIDER_NOT_CONFIGURED");

  const subscriptions = await prisma.newsletterSubscription.findMany({
    where: { status: "ACTIVE" },
    orderBy: { subscribedAt: "asc" },
    take: 500,
  });
  if (!subscriptions.length) throw new Error("NEWSLETTER_NO_ACTIVE_SUBSCRIBERS");

  const campaign = await prisma.newsletterCampaign.create({
    data: {
      subject: input.subject.trim(),
      body: input.body.trim(),
      status: "SENDING",
      createdById: actorId,
      deliveries: { create: subscriptions.map((subscription) => ({ subscriptionId: subscription.id })) },
    },
  });

  let sent = 0;
  let failed = 0;
  for (const subscription of subscriptions) {
    const unsubscribeUrl = new URL(`/newsletter/unsubscribe?token=${encodeURIComponent(subscription.unsubscribeToken)}`, appConfig.APP_BASE_URL).toString();
    try {
      await sendTransactionalEmail({
        to: subscription.email,
        subject: input.subject.trim(),
        text: `${input.body.trim()}\n\n退订：${unsubscribeUrl}`,
        html: buildNewsletterHtml(input.body.trim(), unsubscribeUrl),
      });
      sent += 1;
      await prisma.newsletterDelivery.update({
        where: { campaignId_subscriptionId: { campaignId: campaign.id, subscriptionId: subscription.id } },
        data: { status: "SENT", sentAt: new Date(), attemptCount: { increment: 1 }, lastError: null },
      });
    } catch (error) {
      failed += 1;
      await prisma.newsletterDelivery.update({
        where: { campaignId_subscriptionId: { campaignId: campaign.id, subscriptionId: subscription.id } },
        data: { status: "FAILED", attemptCount: { increment: 1 }, lastError: safeProviderError(error) },
      });
    }
  }

  const updated = await prisma.newsletterCampaign.update({
    where: { id: campaign.id },
    data: { status: failed === 0 ? "SENT" : sent > 0 ? "SENT" : "FAILED", sentAt: sent > 0 ? new Date() : null },
  });
  await prisma.auditLog.create({
    data: { actorId, actorType: "admin", action: "admin.newsletter.campaign.sent", targetType: "newsletter_campaign", targetId: campaign.id, detail: toJson({ sent, failed, total: subscriptions.length }) },
  });
  return { campaign: updated, sent, failed, total: subscriptions.length };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function createUnsubscribeToken() {
  return randomBytes(24).toString("base64url");
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function safeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : "EMAIL_SEND_FAILED";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

function buildNewsletterHtml(body: string, unsubscribeUrl: string) {
  return `<main style="font-family:Arial,sans-serif;line-height:1.7;color:#111"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><strong style="font-size:22px">MerchantKit</strong><div style="margin-top:24px;white-space:pre-line">${escapeHtml(body)}</div><p style="margin-top:32px;font-size:12px;color:#666">不再接收此类邮件？<a href="${escapeHtml(unsubscribeUrl)}">退订</a></p></div></main>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}
