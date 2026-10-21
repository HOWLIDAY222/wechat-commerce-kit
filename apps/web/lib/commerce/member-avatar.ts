export type MemberAvatarRecord = { filename: string | null; revision: number; updatedAt: Date };
export type MemberAvatar = { available: boolean; hasAvatar: boolean; revision: number; updatedAt: string | null };
export function memberAvatarDto(record: MemberAvatarRecord | null, available = true): MemberAvatar {
  return { available, hasAvatar: !!record?.filename, revision: record?.revision ?? 0, updatedAt: record?.updatedAt.toISOString() ?? null };
}
export function parseAvatarRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2147483646 ? value : null;
}
export function safeAvatarFilename(value: string) { return /^[a-f0-9-]{36}\.webp$/.test(value); }
