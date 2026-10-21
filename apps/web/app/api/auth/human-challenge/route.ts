import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createHumanChallenge,
  humanVerificationActions,
} from "@/lib/services/human-verification-service";

const challengeSchema = z.object({
  action: z.enum(humanVerificationActions),
});

export async function POST(request: Request) {
  const parsed = challengeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_HUMAN_CHALLENGE_REQUEST" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    challenge: createHumanChallenge(parsed.data.action),
  });
}
