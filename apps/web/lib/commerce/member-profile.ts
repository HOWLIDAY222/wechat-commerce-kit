import { beijingCalendarDate, isDispatchDate } from "@/lib/commerce/order-dispatch-estimate";

export type MemberGender = "MALE" | "FEMALE" | "UNSPECIFIED" | null;
export type MemberAccountProfile = {
  surname: string; givenName: string; displayName: string; gender: MemberGender;
  region: string[]; birthday: string | null; registeredAt: string | null;
  updatedAt: string | null; revision: number;
};
export type MemberProfileInput = Pick<MemberAccountProfile, "surname" | "givenName" | "displayName" | "gender" | "region" | "birthday"> & {
  expectedRevision: number; completeRegistration: boolean;
};
export type MemberProfileRecord = Omit<MemberAccountProfile, "updatedAt" | "registeredAt"> & {
  updatedAt: Date; registeredAt: Date | null;
};

export function parseMemberProfileInput(value: unknown, now = new Date()): MemberProfileInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const required = ["surname", "givenName", "displayName", "gender", "region", "birthday", "expectedRevision"];
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => ![...required, "completeRegistration"].includes(key))) return null;
  const text = (entry: unknown, max: number) => typeof entry === "string" && !/[\u0000-\u001f\u007f]/u.test(entry) && entry.trim().length <= max ? entry.trim() : null;
  const surname = text(input.surname, 40), givenName = text(input.givenName, 40), displayName = text(input.displayName, 80);
  if (surname === null || givenName === null || displayName === null) return null;
  if (input.gender !== null && (typeof input.gender !== "string" || !["MALE", "FEMALE", "UNSPECIFIED"].includes(input.gender))) return null;
  if (!Array.isArray(input.region) || ![0, 3].includes(input.region.length)) return null;
  const region = Array.from(input.region, entry => text(entry, 80));
  if (region.some(entry => !entry)) return null;
  if (input.birthday !== null && (!isDispatchDate(input.birthday) || input.birthday < "1900-01-01" || input.birthday > beijingCalendarDate(now))) return null;
  if (typeof input.expectedRevision !== "number" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483646) return null;
  if (Object.hasOwn(input, "completeRegistration") && typeof input.completeRegistration !== "boolean") return null;
  return { surname, givenName, displayName, gender: input.gender as MemberGender, region: region as string[], birthday: input.birthday as string | null,
    expectedRevision: input.expectedRevision as number, completeRegistration: input.completeRegistration === true };
}

export function memberProfileDto(record: MemberProfileRecord | null): MemberAccountProfile {
  return { surname: record?.surname ?? "", givenName: record?.givenName ?? "", displayName: record?.displayName ?? "", gender: record?.gender ?? null,
    region: record?.region ?? [], birthday: record?.birthday ?? null, registeredAt: record?.registeredAt?.toISOString() ?? null,
    updatedAt: record?.updatedAt.toISOString() ?? null, revision: record?.revision ?? 0 };
}

// A native bearer token does not use cookies and has no Origin. Cookie callers
// must keep the actual Host; do not accept an arbitrary forwarded host value.
export function hasSameHostMemberProfileOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin), host = request.headers.get("host");
    return !!host && ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}
