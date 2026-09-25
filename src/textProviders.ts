import { request } from "./api";
import { getProviderCredentialStatus, type CloudProvider } from "./providerCredentials";

export type TextProvider = "local" | CloudProvider;
export type TextProviderOptions = { provider: TextProvider; cloudConsent: boolean; credentialGeneration?: string };
async function registeredGeneration(provider: CloudProvider): Promise<string> {
  const state = (await getProviderCredentialStatus())[provider];
  if (!state.configured || !state.generation) throw new Error("API 키 상태를 확인하지 못했습니다. 분석 서버를 확인하고 다시 시도하세요.");
  return state.generation;
}
/** Capture once at run start; reuse this registration for every caption batch. */
export async function beginTextRun(provider: TextProvider, cloudConsent: boolean): Promise<TextProviderOptions> {
  if (provider === "local") return { provider, cloudConsent: false };
  if (!cloudConsent) throw new Error("클라우드 텍스트 전송과 API 비용에 동의한 뒤 시작하세요.");
  return { provider, cloudConsent: true, credentialGeneration: await registeredGeneration(provider) };
}
export async function textProviderModels(provider: CloudProvider): Promise<string[]> {
  const generation = await registeredGeneration(provider);
  const result = await request<{provider: string; models: unknown}>(`/api/translation/models?provider=${provider}&credentialGeneration=${generation}`, { signal: AbortSignal.timeout(20_000) });
  if (result?.provider !== provider || !Array.isArray(result.models) || result.models.length > 1000 ||
    result.models.some(model => typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model))) {
    throw new Error("클라우드 모델 목록이 올바르지 않습니다.");
  }
  return result.models as string[];
}
export function cloudTextReady(provider: TextProvider, model: string, consent: boolean, configured: boolean, busy: boolean): boolean {
  return provider === "local" || configured && !busy && consent && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model);
}
