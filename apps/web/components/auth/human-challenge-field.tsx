"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";

export type HumanVerificationAction = "customer_sms" | "customer_password" | "admin_sms" | "admin_password";

type HumanChallenge = {
  expiresAt: string;
  id: string;
  question: string;
};

type HumanChallengeState = {
  answer: string;
  challenge: HumanChallenge | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setAnswer: (value: string) => void;
};

export function useHumanChallenge(action: HumanVerificationAction): HumanChallengeState {
  const [answer, setAnswer] = useState("");
  const [challenge, setChallenge] = useState<HumanChallenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAnswer("");
    try {
      const response = await fetch("/api/auth/human-challenge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        challenge?: HumanChallenge;
        error?: string;
      };
      if (!response.ok || !result.ok || !result.challenge) {
        throw new Error(result.error ?? "HUMAN_CHALLENGE_LOAD_FAILED");
      }
      setChallenge(result.challenge);
    } catch (loadError) {
      setChallenge(null);
      setError(loadError instanceof Error ? loadError.message : "HUMAN_CHALLENGE_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [action]);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/human-challenge", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          challenge?: HumanChallenge;
          error?: string;
        };
        if (!response.ok || !result.ok || !result.challenge) {
          throw new Error(result.error ?? "HUMAN_CHALLENGE_LOAD_FAILED");
        }
        if (active) setChallenge(result.challenge);
      })
      .catch((loadError) => {
        if (!active) return;
        setChallenge(null);
        setError(loadError instanceof Error ? loadError.message : "HUMAN_CHALLENGE_LOAD_FAILED");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [action]);

  return { answer, challenge, error, loading, refresh, setAnswer };
}

export function HumanChallengeField({
  disabled,
  state,
}: {
  disabled?: boolean;
  state: HumanChallengeState;
}) {
  return (
    <div className="grid gap-2 rounded-[8px] border border-line bg-soft p-3">
      <input name="humanChallengeId" type="hidden" value={state.challenge?.id ?? ""} />
      <div className="flex items-center justify-between gap-3">
        <label className="min-w-0 flex-1 text-sm font-black">
          人机验证
          <span className="mt-1 block text-xs font-bold leading-5 text-muted">
            {state.loading ? "正在生成验证题..." : state.challenge ? `请计算：${state.challenge.question}` : "验证题加载失败，请刷新。"}
          </span>
        </label>
        <button
          aria-label="刷新人机验证题"
          className="vk-focus-ring grid h-9 w-9 shrink-0 place-items-center rounded-[6px] border border-line bg-white"
          disabled={disabled || state.loading}
          onClick={() => void state.refresh()}
          type="button"
        >
          <RotateCw className="h-4 w-4" />
        </button>
      </div>
      <input
        className="vk-store-input h-11"
        disabled={disabled || state.loading || !state.challenge}
        inputMode="numeric"
        name="humanAnswer"
        onChange={(event) => state.setAnswer(event.target.value)}
        placeholder="输入计算结果"
        required
        value={state.answer}
      />
      {state.error ? <p className="text-xs font-black text-[#b42318]">验证题加载失败，请点击刷新后再提交。</p> : null}
    </div>
  );
}
