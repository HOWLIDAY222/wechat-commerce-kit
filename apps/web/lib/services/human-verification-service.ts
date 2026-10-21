import { createHash, randomInt, randomUUID } from "crypto";

export const humanVerificationActions = [
  "customer_sms",
  "customer_password",
  "admin_sms",
  "admin_password",
] as const;

export type HumanVerificationAction = (typeof humanVerificationActions)[number];

type HumanChallengeRecord = {
  action: HumanVerificationAction;
  answerHash: string;
  attempts: number;
  expiresAt: Date;
};

const challengeTtlMs = 10 * 60 * 1000;
const maxChallengeAttempts = 5;

const globalForHumanVerification = globalThis as typeof globalThis & {
  __merchantkitHumanChallenges?: Map<string, HumanChallengeRecord>;
};

const humanChallenges = globalForHumanVerification.__merchantkitHumanChallenges ?? new Map<string, HumanChallengeRecord>();
globalForHumanVerification.__merchantkitHumanChallenges = humanChallenges;

export function createHumanChallenge(action: HumanVerificationAction) {
  pruneHumanChallenges();

  const left = randomInt(2, 10);
  const right = randomInt(2, 10);
  const operator = randomInt(0, 2) === 0 ? "+" : "-";
  const answer = operator === "+" ? left + right : left - right;
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + challengeTtlMs);

  humanChallenges.set(id, {
    action,
    answerHash: hashHumanAnswer(String(answer)),
    attempts: 0,
    expiresAt,
  });

  return {
    id,
    question: `${left} ${operator} ${right} = ?`,
    expiresAt: expiresAt.toISOString(),
  };
}

export function verifyHumanChallenge(input: {
  action: HumanVerificationAction;
  challengeId?: string;
  answer?: string;
}) {
  pruneHumanChallenges();

  const challengeId = input.challengeId?.trim();
  const answer = input.answer?.trim();
  if (!challengeId || !answer) throw new Error("HUMAN_VERIFICATION_REQUIRED");

  const challenge = humanChallenges.get(challengeId);
  if (!challenge) throw new Error("HUMAN_VERIFICATION_EXPIRED");
  if (challenge.action !== input.action) throw new Error("HUMAN_VERIFICATION_INVALID");
  if (challenge.expiresAt.getTime() <= Date.now()) {
    humanChallenges.delete(challengeId);
    throw new Error("HUMAN_VERIFICATION_EXPIRED");
  }
  if (challenge.attempts >= maxChallengeAttempts) {
    humanChallenges.delete(challengeId);
    throw new Error("HUMAN_VERIFICATION_EXPIRED");
  }

  challenge.attempts += 1;
  if (hashHumanAnswer(answer) !== challenge.answerHash) {
    if (challenge.attempts >= maxChallengeAttempts) humanChallenges.delete(challengeId);
    throw new Error("HUMAN_VERIFICATION_INVALID");
  }

  humanChallenges.delete(challengeId);
}

function pruneHumanChallenges() {
  const now = Date.now();
  for (const [id, challenge] of humanChallenges.entries()) {
    if (challenge.expiresAt.getTime() <= now || challenge.attempts >= maxChallengeAttempts) {
      humanChallenges.delete(id);
    }
  }
}

function hashHumanAnswer(answer: string) {
  return createHash("sha256").update(answer.replace(/\s+/g, "")).digest("hex");
}
