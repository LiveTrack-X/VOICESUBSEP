import { request } from "./api";

export type CloudProvider = "groq" | "xai" | "gemini" | "deepgram";
export type CredentialState = { configured: boolean; busy: boolean };
export type ProviderCredentialStatus = Record<CloudProvider, { configured: boolean; generation?: string }>;
export const providerName = (provider: CloudProvider) => ({ groq: "Groq", xai: "xAI", gemini: "Google Gemini", deepgram: "Deepgram" })[provider];
export const validProviderKey = (value: string) => /^[!-~]{12,512}$/u.test(value.trim());
const unavailable = () => new Error("API 키 상태를 확인하지 못했습니다. 분석 서버를 확인하고 다시 시도하세요.");

export function parseProviderCredentialStatus(value: unknown): ProviderCredentialStatus {
  if (!value || typeof value !== "object") throw unavailable();
  const row = value as Record<string, unknown>;
  const configured = (name: CloudProvider) => {
    const item = row[name];
    if (item === undefined && (name === "gemini" || name === "deepgram")) return { configured: false };
    if (!item || typeof item !== "object" || typeof (item as { configured?: unknown }).configured !== "boolean") throw unavailable();
    const { configured, generation } = item as { configured: boolean; generation?: unknown };
    if (generation !== undefined && (typeof generation !== "string" || !/^[a-f0-9]{32}$/.test(generation))) throw unavailable();
    return { configured, ...(configured && typeof generation === "string" ? { generation } : {}) };
  };
  // Keep only public registration metadata, never credential values.
  return { groq: configured("groq"), xai: configured("xai"), gemini: configured("gemini"), deepgram: configured("deepgram") };
}

export async function getProviderCredentialStatus(): Promise<ProviderCredentialStatus> {
  try { return parseProviderCredentialStatus(await request<unknown>("/api/provider-credentials", { cache: "no-store" })); }
  catch { throw unavailable(); }
}
export async function setProviderCredential(provider: CloudProvider, key: string): Promise<ProviderCredentialStatus> {
  try {
    if (!["groq", "xai", "gemini", "deepgram"].includes(provider) || !validProviderKey(key)) throw new Error();
    return parseProviderCredentialStatus(await request<unknown>("/api/provider-credentials", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, key: key.trim() }),
    }));
  } catch {
    // Credential validation errors may echo input. Never expose their detail.
    throw new Error("API 키를 등록하지 못했습니다. 키 형식과 분석 서버를 확인하세요.");
  }
}
export async function removeProviderCredential(provider: CloudProvider): Promise<ProviderCredentialStatus> {
  try {
    if (!["groq", "xai", "gemini", "deepgram"].includes(provider)) throw new Error();
    return parseProviderCredentialStatus(await request<unknown>(`/api/provider-credentials/${provider}`, { method: "DELETE" }));
  } catch { throw new Error("API 키를 제거하지 못했습니다. 분석 서버를 확인하고 다시 시도하세요."); }
}
