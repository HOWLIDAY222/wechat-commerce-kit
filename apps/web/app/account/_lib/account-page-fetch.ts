import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function fetchAccountJson<T>(path: string): Promise<T> {
  const headerStore = await headers();
  const host = headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const cookie = headerStore.get("cookie") ?? "";

  const response = await fetch(`${protocol}://${host}${path}`, {
    cache: "no-store",
    headers: { cookie },
  });

  if (response.status === 401 || response.status === 403) {
    redirect("/auth/login");
  }

  if (!response.ok) {
    throw new Error(`ACCOUNT_PAGE_FETCH_FAILED:${path}:${response.status}`);
  }

  return response.json() as Promise<T>;
}
