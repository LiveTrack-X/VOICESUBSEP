import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { ProviderCredentialPanel } from "./ProviderCredentialPanel";
import { type CredentialState, providerName } from "../providerCredentials";
import { textProviderModels, type TextProvider } from "../textProviders";

export function TextProviderControls({ provider, model, consent, disabled, onProviderChange, onModelChange, onConsentChange, onCredentialState }: {
  provider: TextProvider; model: string; consent: boolean; disabled: boolean;
  onProviderChange: (value: TextProvider) => void; onModelChange: (value: string) => void;
  onConsentChange: (value: boolean) => void; onCredentialState: (value: CredentialState) => void;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<string[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [credential, setCredential] = useState<CredentialState>({ configured: false, busy: true });
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; setModels([]); setLoading(false); setError(""); setCredential({ configured: false, busy: true }); return () => { epoch.current++; }; }, [provider]);
  async function loadModels() {
    if (provider === "local" || loading || disabled || !credential.configured || credential.busy) return;
    const current = epoch.current; setLoading(true); setError("");
    try { const next = await textProviderModels(provider); if (current === epoch.current) setModels(next); }
    catch (cause) { if (current === epoch.current) setError((cause as Error).message); }
    finally { if (current === epoch.current) setLoading(false); }
  }
  return <section className="text-provider-controls">
    <label>{t("텍스트 처리 제공자")}<select aria-label={t("텍스트 처리 제공자")} value={provider} disabled={disabled} onChange={event => onProviderChange(event.target.value as TextProvider)}>
      <option value="local">{t("로컬 Ollama")}</option><option value="groq">Groq</option><option value="xai">xAI</option>
    </select></label>
    {provider === "local" ? <p className="info-box">{t("이 기기의 Ollama 모델만 사용합니다. 모델을 자동 다운로드하지 않습니다.")}</p> : <>
      <ProviderCredentialPanel key={provider} provider={provider} disabled={disabled} onStateChange={state => { setCredential(state); onCredentialState(state); if (!state.configured || state.busy) onConsentChange(false); }} />
      <label>{t("클라우드 텍스트 모델 ID")}<input aria-label={t("클라우드 텍스트 모델 ID")} disabled={disabled} value={model} maxLength={200} list={`text-models-${provider}`} onChange={event => onModelChange(event.target.value)} /></label>
      <datalist id={`text-models-${provider}`}>{models.map(value => <option key={value} value={value} />)}</datalist>
      <button type="button" disabled={disabled || loading || credential.busy || !credential.configured} onClick={() => void loadModels()}>{t("계정 모델 목록 조회")}</button>
      <p>{t("모델 목록 조회는 자막을 보내지 않습니다. 선택한 모델의 텍스트·JSON 지원은 실행 시 확인됩니다.")}</p>
      {models.length > 0 && <p role="status">{t("모델 {count}개 · 입력란에서 선택하거나 ID를 직접 입력하세요.", {count: models.length})}</p>}
      <label className="checkbox-label"><input type="checkbox" checked={consent} disabled={disabled || !credential.configured || credential.busy || !model.trim()} onChange={event => onConsentChange(event.target.checked)} />{t("{provider}로 원문 자막과 인물 이름을 보내며 API 비용이 발생할 수 있음을 확인했습니다.", {provider: providerName(provider)})}</label>
      <p>{t("이 기능은 자막 텍스트만 전송합니다. 원본 음성·영상 파일은 전송하지 않습니다.")}</p>
      {error && <p role="alert" className="error-box">{t(error)}</p>}
    </>}
  </section>;
}
