export type CloudAsrProvider = "groq" | "xai" | "gemini";
export type AsrProvider = "local" | CloudAsrProvider;
export const CLOUD_ASR_MODELS = {
  groq: ["whisper-large-v3-turbo", "whisper-large-v3"],
  xai: ["grok-voice-transcribe-2.0", "grok-voice-transcribe-1.0"],
  gemini: ["gemini-3.5-transcribe"],
} as const;
export type AsrSelection = { provider: "local" } | { provider: CloudAsrProvider; model: string };
export function defaultAsrSelection(provider: AsrProvider = "local"): AsrSelection {
  return provider === "local" ? { provider } : { provider, model: CLOUD_ASR_MODELS[provider][0] };
}
export function cloudAsrBlockReason(selection: AsrSelection, configured: boolean, consent: boolean, busy: boolean): string | null {
  if (selection.provider === "local") return null;
  if (!CLOUD_ASR_MODELS[selection.provider].some(model => model === selection.model)) return "지원하는 음성 인식 모델을 선택하세요.";
  if (busy) return "API 키 상태 확인을 마칠 때까지 기다리세요.";
  if (!configured) return "선택한 제공자의 API 키를 이번 실행에 등록하세요.";
  if (!consent) return "외부 음성 전송과 API 과금을 확인한 뒤 동의하세요.";
  return null;
}
export function cloudAsrRequestFields(selection: AsrSelection, configured: boolean, consent: boolean):
  { asrProvider?: CloudAsrProvider; providerModel?: string; cloudConsent?: true } {
  if (selection.provider === "local") return {};
  const reason = cloudAsrBlockReason(selection, configured, consent, false);
  if (reason) throw new Error(reason);
  return { asrProvider: selection.provider, providerModel: selection.model, cloudConsent: true };
}
