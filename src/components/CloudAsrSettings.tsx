import { useI18n } from "../i18n";
import { CLOUD_ASR_MODELS, defaultAsrSelection, type AsrProvider, type AsrSelection } from "../cloudAsr";
import { type CredentialState, providerName } from "../providerCredentials";
import { ProviderCredentialPanel } from "./ProviderCredentialPanel";
import type { AnalysisPreferences } from "../settings";
import "./cloud-providers.css";

export function CloudAsrSettings({ selection, onChange, consent, onConsent, disabled, credentialBusy, onCredentialState, preferences, onPreferences }: {
  selection: AsrSelection; onChange: (value: AsrSelection) => void;
  consent: boolean; onConsent: (value: boolean) => void; disabled: boolean;
  credentialBusy: boolean; onCredentialState: (state: CredentialState) => void;
  preferences: AnalysisPreferences; onPreferences: (value: Partial<AnalysisPreferences>) => void;
}) {
  const { t } = useI18n();
  return <fieldset className="cloud-asr-settings" disabled={disabled || credentialBusy}>
    <legend>{t("음성 인식 제공자")}</legend>
    <div className="cloud-provider-fields">
      <label>{t("음성 인식 제공자")}<select aria-label={t("음성 인식 제공자")} value={selection.provider} disabled={disabled || credentialBusy}
        onChange={event => onChange(defaultAsrSelection(event.target.value as AsrProvider))}>
        <option value="local">{t("로컬 GPU/CPU")}</option><option value="groq">Groq API</option><option value="xai">xAI API</option><option value="gemini">Google Gemini API</option>
      </select></label>
      {selection.provider === "local" && <>
        <label>{t("로컬 음성 인식 엔진")}<select aria-label={t("로컬 음성 인식 엔진")} value={preferences.localAsrEngine ?? "whisper"}
          onChange={event => onPreferences({ localAsrEngine: event.target.value as "whisper" | "qwen" })}>
          <option value="whisper">faster-whisper</option><option value="qwen">Qwen3-ASR · {t("개발환경 전용")}</option>
        </select></label>
        {(preferences.localAsrEngine ?? "whisper") === "whisper" ? <label>{t("Whisper 모델")}<select aria-label={t("Whisper 모델")} value={preferences.whisperModel}
          onChange={event => onPreferences({ whisperModel: event.target.value as AnalysisPreferences["whisperModel"] })}>
          <option value="large-v3">{t("Large v3 · 정밀 분석용")}</option><option value="large-v3-turbo">{t("Large v3 Turbo · 빠른 분석용")}</option>
          <optgroup label={t("가벼운 모델")}>{["medium", "small", "base", "tiny"].map(model => <option key={model}>{model}</option>)}</optgroup>
        </select></label> : <label>{t("Qwen 음성 인식 모델")}<select aria-label={t("Qwen 음성 인식 모델")} value={preferences.qwenModel ?? "1.7b"}
          onChange={event => onPreferences({ qwenModel: event.target.value as "0.6b" | "1.7b" })}>
          <option value="1.7b">Qwen3-ASR 1.7B</option><option value="0.6b">Qwen3-ASR 0.6B</option>
        </select><small>{t("자막 시간은 Qwen ForcedAligner 0.6B로 정렬합니다. 선택한 모델은 첫 분석 때 별도로 다운로드합니다.")}</small>
          <small>{t("Qwen 실행환경은 현재 일반 설치본에 포함되지 않습니다. 개발환경의 선택 설치가 필요합니다.")}</small></label>}
      </>}
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
    <p>{t("클라우드 음성 인식은 제공자별 API 키가 필요합니다. ChatGPT 구독 로그인과는 별개입니다.")}</p>
  </fieldset>;
}
