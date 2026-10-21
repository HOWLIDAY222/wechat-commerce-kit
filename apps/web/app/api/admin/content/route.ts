import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { contentSettingDefinitions, contentSettingKeys } from "@/lib/content-settings";
import { listAdminSettings, upsertAdminSetting } from "@/lib/services/admin-ops-service";
import { normalizeContentSettingValue } from "@/lib/site-management";

const contentSchema = z.object({
  key: z.enum(contentSettingKeys),
  value: z.string().min(1).max(12000),
});

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const settings = await listAdminSettings();
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));

  return NextResponse.json({
    ok: true,
    content: contentSettingDefinitions.map((definition) => {
      const setting = byKey.get(definition.key);
      return {
        ...definition,
        id: setting?.id ?? null,
        value: typeof setting?.value === "string" ? setting.value : definition.defaultValue,
        source: setting ? "database" : "default",
        updatedAt: setting?.updatedAt ?? null,
      };
    }),
    audit: {
      actorId: session.userId,
      action: "admin.content.list",
      createdAt: new Date().toISOString(),
    },
  });
}

export async function PUT(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = contentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_CONTENT_REQUEST" }, { status: 400 });

  try {
    return NextResponse.json({
      ok: true,
      setting: await upsertAdminSetting(
        {
          key: parsed.data.key,
          value: normalizeContentSettingValue(parsed.data.key, parsed.data.value),
        },
        session.userId,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "CONTENT_UPSERT_FAILED" },
      { status: 400 },
    );
  }
}
