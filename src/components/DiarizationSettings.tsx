import { useI18n } from "../i18n";
import type { CredentialState } from "../providerCredentials";
import { ProviderCredentialPanel } from "./ProviderCredentialPanel";

export function DiarizationSettings({ provider, onChange, consent, onConsent, onCredentialState, disabled }: {
  provider: "nemotron" | "deepgram"; onChange: (value: "nemotron" | "deepgram") => void;
  consent: boolean; onConsent: (value: boolean) => void;
  onCredentialState: (state: CredentialState) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  return <fieldset className="cloud-asr-settings" disabled={disabled}>
    <legend>{t("화자 구분 엔진")}</legend>
    <label>{t("화자 구분 제공자")}<select aria-label={t("화자 구분 제공자")} value={provider} onChange={event => onChange(event.target.value as "nemotron" | "deepgram")}>
      <option value="nemotron">{t("로컬 · Nemotron 3 (기본)")}</option>
      <option value="deepgram">Deepgram API · Nova-3 / Diarization v2</option>
    </select></label>
    <p>{t("화자 구분은 누가 언제 말했는지 표시합니다. 겹친 목소리를 별도 음원으로 추출하는 기능은 아닙니다.")}</p>
    {provider === "deepgram" && <>
      <p>{t("Deepgram은 전사와 결합된 유료 화자 구분 API입니다. 선택한 음성 인식 엔진과 별도로 음성을 전송하며 사용료가 발생할 수 있습니다.")}</p>
      <ProviderCredentialPanel provider="deepgram" disabled={disabled} onStateChange={onCredentialState}/>
      <label className="cloud-consent"><input type="checkbox" checked={consent} onChange={event => onConsent(event.target.checked)}/>
        <span>{t("이번 분석에서 화자 구분을 위해 음성을 Deepgram으로 전송하고 API 과금이 발생할 수 있음에 동의합니다.")}</span></label>
      <small>{t("동의는 저장하지 않습니다. 제공자·모델 변경 또는 다음 분석 때 다시 확인합니다.")}</small>
    </>}
  </fieldset>;
}
