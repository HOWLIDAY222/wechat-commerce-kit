export type AuditInput = {
  actorId?: string;
  actorType: "user" | "admin" | "system";
  action: string;
  targetType: string;
  targetId?: string;
  detail?: unknown;
};

export function auditEnvelope(input: AuditInput) {
  return {
    ...input,
    createdAt: new Date().toISOString(),
  };
}
