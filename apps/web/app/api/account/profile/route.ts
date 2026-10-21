import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { getAccountProfile, updateAccountProfile } from "@/lib/services/account-profile-service";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";

const profileSchema = z.object({
  birthYear: z.number().int().min(1900).max(new Date().getFullYear() - 13).nullable().optional(),
  countryCode: z.string().trim().length(2).toUpperCase().nullable().optional(),
  email: z
    .string()
    .trim()
    .email()
    .max(120)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value ? value : null)),
  name: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(1).max(32),
  gender: z.enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"]).nullable().optional(),
  marketingGranted: z.boolean().optional(),
  personalizationGranted: z.boolean().optional(),
  preferredLocale: z.enum(["zh-CN", "en"]).nullable().optional(),
});

export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    profile: await getAccountProfile(session.userId, { phone: session.phone }),
  });
}

export async function PUT(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = profileSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_ACCOUNT_PROFILE" }, { status: 400 });
  }

  const normalizedPhone = normalizeMainlandPhone(parsed.data.phone);
  if (!isMainlandPhone(normalizedPhone)) {
    return NextResponse.json({ ok: false, error: "INVALID_PHONE" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      ok: true,
      profile: await updateAccountProfile(session.userId, {
        email: parsed.data.email,
        birthYear: parsed.data.birthYear,
        countryCode: parsed.data.countryCode,
        gender: parsed.data.gender,
        marketingGranted: parsed.data.marketingGranted,
        name: parsed.data.name,
        personalizationGranted: parsed.data.personalizationGranted,
        phone: normalizedPhone,
        preferredLocale: parsed.data.preferredLocale,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ACCOUNT_PROFILE_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}
