import { useI18n } from "../i18n";
import { CLOUD_ASR_MODELS, defaultAsrSelection, type AsrProvider, type AsrSelection } from "../cloudAsr";
import { type CredentialState, providerName } from "../providerCredentials";
import { ProviderCredentialPanel } from "./ProviderCredentialPanel";
import "./cloud-providers.css";

export function CloudAsrSettings({ selection, onChange, consent, onConsent, disabled, credentialBusy, onCredentialState }: {
  selection: AsrSelection; onChange: (value: AsrSelection) => void;
  consent: boolean; onConsent: (value: boolean) => void; disabled: boolean;
  credentialBusy: boolean; onCredentialState: (state: CredentialState) => void;
}) {
  const { t } = useI18n();
  return <details className="cloud-asr-settings" open={selection.provider !== "local" || undefined}>
    <summary>{t("고급 설정 · 음성 인식 제공자")} · {selection.provider === "local" ? t("로컬") : providerName(selection.provider)}</summary>
    <div className="cloud-provider-fields">
      <label>{t("음성 인식 제공자")}<select aria-label={t("음성 인식 제공자")} value={selection.provider} disabled={disabled || credentialBusy}
        onChange={event => onChange(defaultAsrSelection(event.target.value as AsrProvider))}>
        <option value="local">{t("로컬 GPU/CPU · faster-whisper")}</option><option value="groq">Groq API</option><option value="xai">xAI API</option>
      </select></label>
      {selection.provider !== "local" && <label>{t("클라우드 음성 인식 모델")}<select aria-label={t("클라우드 음성 인식 모델")} value={selection.model} disabled={disabled || credentialBusy}
        onChange={event => onChange({ ...selection, model: event.target.value })}>
        {CLOUD_ASR_MODELS[selection.provider].map(model => <option key={model}>{model}</option>)}
      </select></label>}
    </div>
    {selection.provider === "local" ? <p>{t("음성 인식은 이 기기에서 처리합니다. 클라우드 키가 없어도 사용할 수 있습니다.")}</p> : <>
      <p>{t("선택한 단일 오디오 트랙을 외부 API로 전송합니다. OBS 분리 트랙 분석은 현재 로컬 모드에서 사용할 수 있습니다.")}</p>
      <ProviderCredentialPanel key={selection.provider} provider={selection.provider} disabled={disabled} onStateChange={onCredentialState}/>
      <label className="cloud-consent"><input type="checkbox" checked={consent} disabled={disabled || credentialBusy} onChange={event => onConsent(event.target.checked)}/>
        <span>{t("이번 분석에서 음성을 {provider}로 보내고 해당 API 계정에 사용료가 발생할 수 있음에 동의합니다.", { provider: providerName(selection.provider) })}</span></label>
      <small>{t("동의는 저장하지 않습니다. 제공자·모델 변경 또는 다음 분석 때 다시 확인합니다.")}</small>
    </>}
    <p>{t("ChatGPT 구독 로그인은 이 독립 앱의 ASR·번역 API 인증으로 지원하지 않습니다. 클라우드는 제공자별 API 키가 필요합니다.")}</p>
  </details>;
}
