-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SmsScene" AS ENUM ('LOGIN', 'REGISTER', 'CHECKOUT');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ProductSaleMode" AS ENUM ('SHOWCASE', 'PREORDER', 'IN_STOCK', 'PAUSED');

-- CreateEnum
CREATE TYPE "InventoryAction" AS ENUM ('ADJUST', 'RESERVE', 'RELEASE', 'DEDUCT', 'RESTOCK');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'CONFIRMED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'RETURNED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('MOCK', 'ALIPAY', 'WECHAT_PAY');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'REQUIRES_REDIRECT', 'PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AfterSalesType" AS ENUM ('RETURN_REFUND', 'EXCHANGE', 'REFUND_ONLY', 'RESHIP', 'QUALITY_ISSUE');

-- CreateEnum
CREATE TYPE "AfterSalesStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'WAITING_RETURN', 'RETURN_IN_TRANSIT', 'RECEIVED', 'INSPECTING', 'REFUND_PROCESSING', 'REFUNDED', 'EXCHANGE_SHIPPING', 'RESHIPPED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('CREATED', 'MANUAL_MARKED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "UploadScope" AS ENUM ('AFTER_SALES', 'PRODUCT', 'CONTENT');

-- CreateEnum
CREATE TYPE "SitePageKind" AS ENUM ('HOME', 'CONTENT', 'HEADER', 'FOOTER');

-- CreateEnum
CREATE TYPE "SiteVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NewsletterStatus" AS ENUM ('ACTIVE', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "ContactInquiryStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "NewsletterCampaignStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NewsletterDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "CustomerGender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "PrivacyConsentCategory" AS ENUM ('ANALYTICS', 'PERSONALIZATION', 'DEVICE', 'MARKETING');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "password_hash" TEXT,
    "password_salt" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_fit_profiles" (
    "user_id" TEXT NOT NULL,
    "height_cm" DECIMAL(4,1),
    "weight_kg" DECIMAL(4,1),
    "waist_cm" DECIMAL(4,1),
    "preference" TEXT NOT NULL DEFAULT 'regular',
    "consent_at" TIMESTAMPTZ(6) NOT NULL,
    "consent_version" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_fit_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gender" "CustomerGender",
    "birth_year" INTEGER,
    "country_code" TEXT,
    "preferred_locale" TEXT,
    "personalization_granted" BOOLEAN NOT NULL DEFAULT false,
    "marketing_granted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_visitors" (
    "id" TEXT NOT NULL,
    "anonymous_id" TEXT NOT NULL,
    "user_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locale" TEXT,
    "language" TEXT,
    "country_code" TEXT,
    "region" TEXT,
    "device_type" TEXT,
    "browser" TEXT,
    "operating_system" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer_host" TEXT,
    "entry_path" TEXT,
    "last_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_sessions" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_key" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entry_path" TEXT NOT NULL,
    "last_path" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "locale" TEXT,
    "referrer_host" TEXT,
    "page_views" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "locale" TEXT,
    "product_id" TEXT,
    "properties" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_consents" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT,
    "user_id" TEXT,
    "category" "PrivacyConsentCategory" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "policy_version" TEXT NOT NULL,
    "locale" TEXT,
    "source" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMP(3),

    CONSTRAINT "privacy_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_identities" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "user_id" TEXT,
    "fingerprint_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "device_type" TEXT,
    "browser" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "risk_score" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "device_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_identities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "open_id" TEXT NOT NULL,
    "union_id" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wechat_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "miniprogram_cart_imports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "miniprogram_cart_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sms_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "phone" TEXT NOT NULL,
    "scene" "SmsScene" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "phone" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "success" BOOLEAN NOT NULL,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scene" TEXT,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "silhouette" TEXT,
    "rise" TEXT,
    "coverage" TEXT,
    "support_level" TEXT,
    "fabric_composition" TEXT,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fit_note" TEXT,
    "care_instructions" TEXT,
    "pack_size" INTEGER,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "sale_mode" "ProductSaleMode" NOT NULL DEFAULT 'SHOWCASE',
    "sale_starts_at" TIMESTAMP(3),
    "estimated_ship_at" TIMESTAMP(3),
    "countdown_enabled" BOOLEAN NOT NULL DEFAULT false,
    "show_price" BOOLEAN NOT NULL DEFAULT false,
    "quantity_pricing" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "image_url" TEXT NOT NULL,
    "alt" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_skus" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku_code" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_logs" (
    "before_quantity" INTEGER,
    "after_quantity" INTEGER,
    "reserved_snapshot" INTEGER,
    "operation" TEXT,
    "id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "action" "InventoryAction" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "style" TEXT NOT NULL DEFAULT '',
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "detail" TEXT NOT NULL,
    "postal_code" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "kind" TEXT NOT NULL DEFAULT 'STANDARD',
    "member_points_policy" JSONB,
    "member_rewards_settled_at" TIMESTAMP(3),
    "source" TEXT,
    "coupon_claim_id" TEXT,
    "discount_label" TEXT,
    "id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address_id" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "fulfillment_status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "shipping_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "payable_amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "address_snapshot" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "style" TEXT NOT NULL DEFAULT '',
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "discount_share_cents" INTEGER NOT NULL DEFAULT 0,
    "refund_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "method" TEXT NOT NULL,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "merchant_order_no" TEXT NOT NULL,
    "gateway_trade_no" TEXT,
    "redirect_url" TEXT,
    "raw_request" JSONB,
    "raw_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_notifications" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "trade_no" TEXT NOT NULL,
    "order_id" TEXT,
    "payment_id" TEXT,
    "status" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "wechat_synced_at" TIMESTAMP(3),
    "wechat_sync_error" TEXT,
    "wechat_sync_attempts" INTEGER NOT NULL DEFAULT 0,
    "wechat_retry_at" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'PROCESSING',
    "tracking_company" TEXT,
    "tracking_no" TEXT,
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_items" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales_requests" (
    "id" TEXT NOT NULL,
    "after_sales_no" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" "AfterSalesType" NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "AfterSalesStatus" NOT NULL DEFAULT 'SUBMITTED',
    "refund_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "admin_note" TEXT,
    "reject_reason" TEXT,
    "return_address" TEXT,
    "return_tracking_company" TEXT,
    "return_tracking_no" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "after_sales_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales_items" (
    "id" TEXT NOT NULL,
    "after_sales_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "refund_amount_cents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "after_sales_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales_images" (
    "id" TEXT NOT NULL,
    "after_sales_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sales_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "after_sales_messages" (
    "id" TEXT NOT NULL,
    "after_sales_id" TEXT NOT NULL,
    "sender_type" "SenderType" NOT NULL,
    "sender_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "after_sales_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "after_sales_id" TEXT,
    "payment_id" TEXT,
    "refund_no" TEXT NOT NULL,
    "refund_amount_cents" INTEGER NOT NULL,
    "refund_status" "RefundStatus" NOT NULL DEFAULT 'CREATED',
    "payment_refund_id" TEXT,
    "reason" TEXT NOT NULL,
    "admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" TEXT NOT NULL,
    "scope" "UploadScope" NOT NULL,
    "owner_id" TEXT,
    "url" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_logistics_bindings" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "buyer_open_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "tracking_fingerprint" TEXT NOT NULL,
    "tracking_company" TEXT NOT NULL,
    "tracking_no" TEXT NOT NULL,
    "activation_at" TIMESTAMPTZ NOT NULL,
    "state" TEXT NOT NULL,
    "waybill_token" TEXT,
    "error_code" TEXT,
    "attempt_started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_logistics_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscriptions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "NewsletterStatus" NOT NULL DEFAULT 'ACTIVE',
    "unsubscribe_token" TEXT NOT NULL,
    "source" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "subscribed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_applications" (
    "id" UUID NOT NULL,
    "details" JSONB NOT NULL,
    "resume" BYTEA,
    "resume_name" TEXT,
    "ip_hash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "career_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "career_images" (
    "application_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "filename" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "career_images_pkey" PRIMARY KEY ("application_id","position")
);

-- CreateTable
CREATE TABLE "contact_inquiries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ContactInquiryStatus" NOT NULL DEFAULT 'NEW',
    "admin_note" TEXT,
    "assignee_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_campaigns" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "NewsletterCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_deliveries" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "status" "NewsletterDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "newsletter_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_pages" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT,
    "kind" "SitePageKind" NOT NULL,
    "template" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_page_versions" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "SiteVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "document" JSONB NOT NULL,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "og_image_url" TEXT,
    "change_note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "published_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "site_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt_text" TEXT,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "status" "MediaAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_profiles" (
    "points_balance" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_templates" (
    "delivery_mode" TEXT NOT NULL DEFAULT 'PUBLIC',
    "points_cost" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "minimum_cents" INTEGER NOT NULL,
    "product_ids" TEXT[],
    "newcomer_only" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "total_limit" INTEGER NOT NULL,
    "issued_count" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_claims" (
    "source" TEXT NOT NULL DEFAULT 'PUBLIC',
    "points_spent" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "held_order_id" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "coupon_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "point_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "order_id" TEXT,
    "actor_id" TEXT,
    "basis_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "point_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_card_templates" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gift_card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_cards" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_id" TEXT,
    "purchase_order_id" TEXT,
    "redemption_order_id" TEXT,
    "request_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "share_nonce" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "issuer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "redeemed_at" TIMESTAMP(3),

    CONSTRAINT "gift_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_dispatch_estimates" (
    "order_id" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "revision" INTEGER NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_dispatch_estimates_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "member_account_profiles" (
    "user_id" TEXT NOT NULL,
    "surname" TEXT NOT NULL DEFAULT '',
    "given_name" TEXT NOT NULL DEFAULT '',
    "display_name" TEXT NOT NULL DEFAULT '',
    "gender" TEXT,
    "region" JSONB NOT NULL DEFAULT '[]',
    "birthday" DATE,
    "registered_at" TIMESTAMPTZ(6),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_account_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "member_account_avatars" (
    "user_id" TEXT NOT NULL,
    "filename" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_account_avatars_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "member_operation_settings" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_operation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_operation_records" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_operation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_subscription_settings" (
    "id" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_subscription_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_subscription_preferences" (
    "user_id" TEXT NOT NULL,
    "enabled_channels" JSONB NOT NULL DEFAULT '[]',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_subscription_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "wechat_subscription_receipts" (
    "user_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_subscription_receipts_pkey" PRIMARY KEY ("user_id","request_id")
);

-- CreateTable
CREATE TABLE "wechat_subscription_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_subscription_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_subscription_campaigns" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by" TEXT NOT NULL,
    "queued_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_subscription_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wechat_subscription_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "error_code" TEXT,
    "attempt_started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wechat_subscription_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_pickups" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "point_name" TEXT NOT NULL,
    "point_address" TEXT NOT NULL,
    "point_hours" TEXT NOT NULL,
    "point_phone" TEXT NOT NULL,
    "code_cipher" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3),
    "collected_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_visitors_anonymous_id_key" ON "analytics_visitors"("anonymous_id");

-- CreateIndex
CREATE INDEX "analytics_visitors_user_id_last_seen_at_idx" ON "analytics_visitors"("user_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "analytics_visitors_last_seen_at_idx" ON "analytics_visitors"("last_seen_at");

-- CreateIndex
CREATE INDEX "analytics_visitors_source_last_seen_at_idx" ON "analytics_visitors"("source", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_sessions_session_key_key" ON "analytics_sessions"("session_key");

-- CreateIndex
CREATE INDEX "analytics_sessions_visitor_id_started_at_idx" ON "analytics_sessions"("visitor_id", "started_at");

-- CreateIndex
CREATE INDEX "analytics_sessions_user_id_started_at_idx" ON "analytics_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "analytics_sessions_started_at_idx" ON "analytics_sessions"("started_at");

-- CreateIndex
CREATE INDEX "analytics_events_occurred_at_idx" ON "analytics_events"("occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_name_occurred_at_idx" ON "analytics_events"("name", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_path_occurred_at_idx" ON "analytics_events"("path", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_visitor_id_occurred_at_idx" ON "analytics_events"("visitor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_session_id_occurred_at_idx" ON "analytics_events"("session_id", "occurred_at");

-- CreateIndex
CREATE INDEX "analytics_events_product_id_occurred_at_idx" ON "analytics_events"("product_id", "occurred_at");

-- CreateIndex
CREATE INDEX "privacy_consents_visitor_id_category_recorded_at_idx" ON "privacy_consents"("visitor_id", "category", "recorded_at");

-- CreateIndex
CREATE INDEX "privacy_consents_user_id_category_recorded_at_idx" ON "privacy_consents"("user_id", "category", "recorded_at");

-- CreateIndex
CREATE INDEX "privacy_consents_recorded_at_idx" ON "privacy_consents"("recorded_at");

-- CreateIndex
CREATE INDEX "device_identities_fingerprint_hash_last_seen_at_idx" ON "device_identities"("fingerprint_hash", "last_seen_at");

-- CreateIndex
CREATE INDEX "device_identities_user_id_last_seen_at_idx" ON "device_identities"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_identities_visitor_id_fingerprint_hash_key" ON "device_identities"("visitor_id", "fingerprint_hash");

-- CreateIndex
CREATE INDEX "wechat_identities_user_id_idx" ON "wechat_identities"("user_id");

-- CreateIndex
CREATE INDEX "wechat_identities_union_id_idx" ON "wechat_identities"("union_id");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_identities_app_id_open_id_key" ON "wechat_identities"("app_id", "open_id");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_identities_user_id_app_id_key" ON "wechat_identities"("user_id", "app_id");

-- CreateIndex
CREATE INDEX "miniprogram_cart_imports_user_id_idx" ON "miniprogram_cart_imports"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "sms_codes_phone_scene_consumed_at_idx" ON "sms_codes"("phone", "scene", "consumed_at");

-- CreateIndex
CREATE INDEX "sms_codes_expires_at_idx" ON "sms_codes"("expires_at");

-- CreateIndex
CREATE INDEX "login_logs_user_id_created_at_idx" ON "login_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "login_logs_phone_created_at_idx" ON "login_logs"("phone", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_images_asset_id_idx" ON "product_images"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_skus_sku_code_key" ON "product_skus"("sku_code");

-- CreateIndex
CREATE INDEX "product_skus_product_id_idx" ON "product_skus"("product_id");

-- CreateIndex
CREATE INDEX "product_skus_color_size_idx" ON "product_skus"("color", "size");

-- CreateIndex
CREATE INDEX "inventory_logs_sku_id_created_at_idx" ON "inventory_logs"("sku_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_guest_key_key" ON "carts"("guest_key");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_sku_id_style_key" ON "cart_items"("cart_id", "sku_id", "style");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_product_id_key" ON "favorites"("user_id", "product_id");

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "payment_intents_order_id_idx" ON "payment_intents"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_provider_merchant_order_no_key" ON "payment_intents"("provider", "merchant_order_no");

-- CreateIndex
CREATE INDEX "payment_notifications_order_id_idx" ON "payment_notifications"("order_id");

-- CreateIndex
CREATE INDEX "payment_notifications_payment_id_idx" ON "payment_notifications"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_notifications_provider_trade_no_key" ON "payment_notifications"("provider", "trade_no");

-- CreateIndex
CREATE INDEX "shipment_items_order_item_id_idx" ON "shipment_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_items_shipment_id_order_item_id_key" ON "shipment_items"("shipment_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "after_sales_requests_after_sales_no_key" ON "after_sales_requests"("after_sales_no");

-- CreateIndex
CREATE INDEX "after_sales_requests_user_id_created_at_idx" ON "after_sales_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "after_sales_requests_order_id_idx" ON "after_sales_requests"("order_id");

-- CreateIndex
CREATE INDEX "after_sales_requests_status_idx" ON "after_sales_requests"("status");

-- CreateIndex
CREATE INDEX "after_sales_items_after_sales_id_idx" ON "after_sales_items"("after_sales_id");

-- CreateIndex
CREATE INDEX "after_sales_items_order_item_id_idx" ON "after_sales_items"("order_item_id");

-- CreateIndex
CREATE INDEX "after_sales_messages_after_sales_id_created_at_idx" ON "after_sales_messages"("after_sales_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_no_key" ON "refunds"("refund_no");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_after_sales_id_idx" ON "refunds"("after_sales_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "uploads_scope_owner_id_idx" ON "uploads"("scope", "owner_id");

-- CreateIndex
CREATE INDEX "wechat_logistics_order_idx" ON "wechat_logistics_bindings"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_logistics_shipment_fingerprint_key" ON "wechat_logistics_bindings"("shipment_id", "tracking_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_key_key" ON "site_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscriptions_email_key" ON "newsletter_subscriptions"("email");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscriptions_unsubscribe_token_key" ON "newsletter_subscriptions"("unsubscribe_token");

-- CreateIndex
CREATE INDEX "newsletter_subscriptions_status_subscribed_at_idx" ON "newsletter_subscriptions"("status", "subscribed_at");

-- CreateIndex
CREATE INDEX "career_applications_created_at_idx" ON "career_applications"("created_at");

-- CreateIndex
CREATE INDEX "career_applications_ip_hash_created_at_idx" ON "career_applications"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "contact_inquiries_status_created_at_idx" ON "contact_inquiries"("status", "created_at");

-- CreateIndex
CREATE INDEX "contact_inquiries_assignee_id_status_idx" ON "contact_inquiries"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "newsletter_campaigns_status_created_at_idx" ON "newsletter_campaigns"("status", "created_at");

-- CreateIndex
CREATE INDEX "newsletter_deliveries_status_created_at_idx" ON "newsletter_deliveries"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_deliveries_campaign_id_subscription_id_key" ON "newsletter_deliveries"("campaign_id", "subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_key_key" ON "site_pages"("key");

-- CreateIndex
CREATE UNIQUE INDEX "site_pages_path_key" ON "site_pages"("path");

-- CreateIndex
CREATE INDEX "site_pages_kind_sort_order_idx" ON "site_pages"("kind", "sort_order");

-- CreateIndex
CREATE INDEX "site_page_versions_page_id_status_version_number_idx" ON "site_page_versions"("page_id", "status", "version_number");

-- CreateIndex
CREATE INDEX "site_page_versions_published_at_idx" ON "site_page_versions"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_page_versions_page_id_version_number_key" ON "site_page_versions"("page_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_url_key" ON "media_assets"("url");

-- CreateIndex
CREATE INDEX "media_assets_status_created_at_idx" ON "media_assets"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_profiles_user_id_key" ON "member_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_claims_held_order_id_key" ON "coupon_claims"("held_order_id");

-- CreateIndex
CREATE INDEX "coupon_claims_user_id_template_id_idx" ON "coupon_claims"("user_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "point_entries_event_key_key" ON "point_entries"("event_key");

-- CreateIndex
CREATE INDEX "point_entries_user_id_created_at_idx" ON "point_entries"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "point_entries_order_id_idx" ON "point_entries"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_purchase_order_id_key" ON "gift_cards"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_redemption_order_id_key" ON "gift_cards"("redemption_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "gift_cards_request_key_key" ON "gift_cards"("request_key");

-- CreateIndex
CREATE INDEX "gift_cards_sender_id_created_at_idx" ON "gift_cards"("sender_id", "created_at");

-- CreateIndex
CREATE INDEX "gift_cards_recipient_id_created_at_idx" ON "gift_cards"("recipient_id", "created_at");

-- CreateIndex
CREATE INDEX "member_operation_records_review_idx" ON "member_operation_records"("kind", "state", "created_at");

-- CreateIndex
CREATE INDEX "member_operation_records_user_idx" ON "member_operation_records"("user_id", "kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_operation_records_kind_user_id_subject_id_key" ON "member_operation_records"("kind", "user_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_subscription_grants_user_id_request_id_channel_key" ON "wechat_subscription_grants"("user_id", "request_id", "channel");

-- CreateIndex
CREATE INDEX "wechat_subscription_deliveries_state" ON "wechat_subscription_deliveries"("state", "attempt_started_at");

-- CreateIndex
CREATE UNIQUE INDEX "wechat_subscription_deliveries_user_id_channel_event_key_key" ON "wechat_subscription_deliveries"("user_id", "channel", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "order_pickups_order_id_key" ON "order_pickups"("order_id");

-- CreateIndex
CREATE INDEX "order_pickups_status_idx" ON "order_pickups"("status");

-- AddForeignKey
ALTER TABLE "customer_fit_profiles" ADD CONSTRAINT "customer_fit_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_visitors" ADD CONSTRAINT "analytics_visitors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "analytics_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_sessions" ADD CONSTRAINT "analytics_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "analytics_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "analytics_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "analytics_visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_identities" ADD CONSTRAINT "device_identities_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "analytics_visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_identities" ADD CONSTRAINT "device_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wechat_identities" ADD CONSTRAINT "wechat_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miniprogram_cart_imports" ADD CONSTRAINT "miniprogram_cart_imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sms_codes" ADD CONSTRAINT "sms_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_claim_id_fkey" FOREIGN KEY ("coupon_claim_id") REFERENCES "coupon_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_notifications" ADD CONSTRAINT "payment_notifications_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_requests" ADD CONSTRAINT "after_sales_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_requests" ADD CONSTRAINT "after_sales_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_items" ADD CONSTRAINT "after_sales_items_after_sales_id_fkey" FOREIGN KEY ("after_sales_id") REFERENCES "after_sales_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_items" ADD CONSTRAINT "after_sales_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_images" ADD CONSTRAINT "after_sales_images_after_sales_id_fkey" FOREIGN KEY ("after_sales_id") REFERENCES "after_sales_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "after_sales_messages" ADD CONSTRAINT "after_sales_messages_after_sales_id_fkey" FOREIGN KEY ("after_sales_id") REFERENCES "after_sales_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_after_sales_id_fkey" FOREIGN KEY ("after_sales_id") REFERENCES "after_sales_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "career_images" ADD CONSTRAINT "career_images_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "career_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_inquiries" ADD CONSTRAINT "contact_inquiries_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "newsletter_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "newsletter_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_page_versions" ADD CONSTRAINT "site_page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "site_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_claims" ADD CONSTRAINT "coupon_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_claims" ADD CONSTRAINT "coupon_claims_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "coupon_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_claims" ADD CONSTRAINT "coupon_claims_held_order_id_fkey" FOREIGN KEY ("held_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_card_templates" ADD CONSTRAINT "gift_card_templates_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "gift_card_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_redemption_order_id_fkey" FOREIGN KEY ("redemption_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_pickups" ADD CONSTRAINT "order_pickups_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Schema-only auxiliary tables used by the community services.
CREATE TABLE member_reward_events (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 80),
  recipient_identity TEXT NOT NULL,
  subject_identity TEXT NOT NULL,
  user_id TEXT NOT NULL,
  subject_user_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  order_id TEXT,
  coupon_claim_id TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (length(state) BETWEEN 1 AND 80),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE member_reward_identity_aliases (
  identity TEXT PRIMARY KEY,
  canonical_identity TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE member_reward_account_identities (
  user_id TEXT PRIMARY KEY,
  identity TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE member_social_uploads (
  id TEXT PRIMARY KEY CHECK (id ~ '^msu_[a-f0-9]{32}$'),
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  filename TEXT NOT NULL CHECK (filename ~ '^[a-f0-9-]{36}\.webp$'),
  checksum TEXT NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 3145728),
  application_id TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, request_id)
);
ALTER TABLE member_social_uploads ADD COLUMN purpose TEXT NOT NULL DEFAULT 'SOCIAL';
ALTER TABLE member_social_uploads ADD CONSTRAINT member_social_uploads_purpose_check CHECK (purpose IN ('SOCIAL','STUDENT','ENTERPRISE'));
CREATE INDEX member_social_uploads_purpose_checksum_idx ON member_social_uploads(user_id,purpose,checksum);
CREATE INDEX member_reward_events_recipient_kind_idx ON member_reward_events (recipient_identity, kind, created_at);
CREATE INDEX member_reward_events_subject_kind_idx ON member_reward_events (subject_identity, kind, created_at);
CREATE INDEX member_reward_events_order_idx ON member_reward_events (order_id);
CREATE INDEX member_reward_events_user_idx ON member_reward_events (user_id, created_at);
CREATE UNIQUE INDEX member_reward_events_coupon_idx ON member_reward_events (coupon_claim_id) WHERE coupon_claim_id IS NOT NULL;
CREATE INDEX member_reward_identity_aliases_canonical_idx ON member_reward_identity_aliases(canonical_identity);
CREATE INDEX member_reward_account_identities_identity_idx ON member_reward_account_identities(identity);
CREATE INDEX member_social_uploads_owner_idx ON member_social_uploads(user_id, created_at);
CREATE INDEX member_social_uploads_application_idx ON member_social_uploads(application_id);

-- PostgreSQL CHECK constraints are not representable in Prisma schema.
ALTER TABLE "products" ADD CONSTRAINT "products_pack_size_positive" CHECK ("pack_size" IS NULL OR "pack_size" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_cents_nonnegative" CHECK ("discount_cents" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_share_cents_nonnegative" CHECK ("discount_share_cents" >= 0);
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_birth_year_check" CHECK ("birth_year" IS NULL OR ("birth_year" >= 1900 AND "birth_year" <= 2100));
ALTER TABLE "device_identities" ADD CONSTRAINT "device_identities_risk_score_check" CHECK ("risk_score" >= 0 AND "risk_score" <= 100);
ALTER TABLE "career_applications" ADD CONSTRAINT "career_applications_status_community_check" CHECK (status IN ('NEW','REVIEWED'));
ALTER TABLE "career_applications" ADD CONSTRAINT "career_resume_size" CHECK (resume IS NULL OR octet_length(resume) <= 20971520);
ALTER TABLE "career_images" ADD CONSTRAINT "career_images_position_community_check" CHECK (position BETWEEN 0 AND 4);
ALTER TABLE "career_images" ADD CONSTRAINT "career_images_extension_community_check" CHECK (extension IN ('jpg','png','webp'));
ALTER TABLE "career_images" ADD CONSTRAINT "career_images_bytes_community_check" CHECK (octet_length(bytes) BETWEEN 1 AND 10485760);
ALTER TABLE "gift_card_templates" ADD CONSTRAINT "gift_card_templates_quantity_community_check" CHECK ("quantity" BETWEEN 1 AND 99);
ALTER TABLE "gift_card_templates" ADD CONSTRAINT "gift_card_templates_amount_cents_community_check" CHECK ("amount_cents">0);
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_status_valid" CHECK ("status" IN ('PENDING_PAYMENT','READY','CLAIMED','REDEEMING','REDEEMED','REFUND_PENDING','REFUNDED','VOID','CANCELLED'));
ALTER TABLE "wechat_logistics_bindings" ADD CONSTRAINT "wechat_logistics_bindings_state_community_check" CHECK ("state" IN ('SENDING', 'BOUND', 'FAILED', 'UNKNOWN'));
ALTER TABLE "wechat_logistics_bindings" ADD CONSTRAINT "wechat_logistics_bound_token_check" CHECK (("state" = 'BOUND' AND "waybill_token" IS NOT NULL) OR ("state" <> 'BOUND' AND "waybill_token" IS NULL));
ALTER TABLE "member_account_avatars" ADD CONSTRAINT "member_account_avatars_revision_community_check" CHECK (revision >= 1);
ALTER TABLE "member_account_avatars" ADD CONSTRAINT "member_avatar_filename" CHECK (filename IS NULL OR filename ~ '^[a-f0-9-]{36}\.webp$');
ALTER TABLE "member_account_profiles" ADD CONSTRAINT "member_account_profile_revision" CHECK (revision >= 1);
ALTER TABLE "member_account_profiles" ADD CONSTRAINT "member_account_profile_gender" CHECK (gender IS NULL OR gender IN ('MALE', 'FEMALE', 'UNSPECIFIED'));
ALTER TABLE "member_account_profiles" ADD CONSTRAINT "member_account_profile_region" CHECK (jsonb_typeof(region) = 'array' AND jsonb_array_length(region) IN (0, 3));
ALTER TABLE "member_account_profiles" ADD CONSTRAINT "member_account_profile_names" CHECK (char_length(surname) <= 40 AND char_length(given_name) <= 40 AND char_length(display_name) <= 80);
ALTER TABLE "member_account_profiles" ADD CONSTRAINT "member_account_profile_birthday" CHECK (birthday IS NULL OR birthday >= DATE '1900-01-01');
ALTER TABLE "member_operation_settings" ADD CONSTRAINT "member_operation_settings_revision_community_check" CHECK (revision >= 1);
ALTER TABLE "member_operation_settings" ADD CONSTRAINT "member_operation_settings_config_community_check" CHECK (jsonb_typeof(config) = 'object');
ALTER TABLE "member_operation_records" ADD CONSTRAINT "member_operation_records_kind_community_check" CHECK (kind IN ('CLAIM', 'APPLICATION', 'SURVEY', 'REFERRAL_CODE', 'REFERRAL', 'DRAW', 'POST', 'REACTION', 'REPORT', 'SHARE', 'SHARE_VISIT'));
ALTER TABLE "member_operation_records" ADD CONSTRAINT "member_operation_records_state_community_check" CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'REWARDED', 'ACTIVE'));
ALTER TABLE "member_operation_records" ADD CONSTRAINT "member_operation_records_payload_community_check" CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE "member_operation_records" ADD CONSTRAINT "member_operation_records_revision_community_check" CHECK (revision >= 1);
ALTER TABLE "order_dispatch_estimates" ADD CONSTRAINT "order_dispatch_estimates_revision_community_check" CHECK ("revision" >= 1);
ALTER TABLE "order_dispatch_estimates" ADD CONSTRAINT "order_dispatch_estimate_date_pair" CHECK (("start_date" IS NULL) = ("end_date" IS NULL));
ALTER TABLE "order_dispatch_estimates" ADD CONSTRAINT "order_dispatch_estimate_date_order" CHECK ("start_date" <= "end_date");
ALTER TABLE "wechat_subscription_settings" ADD CONSTRAINT "wechat_subscription_settings_revision_community_check" CHECK (revision >= 0);
ALTER TABLE "wechat_subscription_preferences" ADD CONSTRAINT "wechat_subscription_preferences_revision_community_check" CHECK (revision >= 0);
ALTER TABLE "wechat_subscription_campaigns" ADD CONSTRAINT "wechat_subscription_campaigns_status_community_check" CHECK (status IN('DRAFT','QUEUED','COMPLETED','CANCELLED'));
ALTER TABLE "wechat_subscription_deliveries" ADD CONSTRAINT "wechat_subscription_deliveries_state_community_check" CHECK (state IN('SENDING','SENT','REJECTED','UNKNOWN','SKIPPED'));
ALTER TABLE "order_pickups" ADD CONSTRAINT "order_pickups_status_community_check" CHECK (status IN ('WAITING','READY','COLLECTED'));
ALTER TABLE "order_pickups" ADD CONSTRAINT "order_pickups_failed_attempts_community_check" CHECK (failed_attempts >= 0);
ALTER TABLE "order_pickups" ADD CONSTRAINT "order_pickups_value_community_check" CHECK (status = 'WAITING' OR ready_at IS NOT NULL);
