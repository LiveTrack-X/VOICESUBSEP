import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { getProviderCredentialStatus, providerName, removeProviderCredential, setProviderCredential, validProviderKey, type CloudProvider, type CredentialState } from "../providerCredentials";
import "./cloud-providers.css";

export function ProviderCredentialPanel({ provider, disabled = false, onStateChange }: {
  provider: CloudProvider; disabled?: boolean; onStateChange: (state: CredentialState) => void;
}) {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const change = useRef(onStateChange); change.current = onStateChange;
  useEffect(() => { change.current({ configured, busy }); }, [configured, busy]);
  useEffect(() => {
    const current = ++epoch.current;
    setKey(""); setConfigured(false); setBusy(true); setError("");
    void getProviderCredentialStatus().then(status => {
      if (epoch.current === current) setConfigured(status[provider].configured);
    }).catch(cause => { if (epoch.current === current) setError((cause as Error).message); })
      .finally(() => { if (epoch.current === current) setBusy(false); });
    return () => { epoch.current++; };
  }, [provider]);

  async function act(action: "register" | "remove" | "refresh") {
    if (disabled || busy) return;
    const current = epoch.current;
    const submittedKey = key;
    setKey(""); setBusy(true); setError("");
    try {
      const status = action === "register" ? await setProviderCredential(provider, submittedKey)
        : action === "remove" ? await removeProviderCredential(provider) : await getProviderCredentialStatus();
      if (epoch.current === current) setConfigured(status[provider].configured);
    } catch(cause) {
      if (epoch.current === current) { setConfigured(false); setError((cause as Error).message); }
    } finally { if (epoch.current === current) setBusy(false); }
  }

  return <div className="provider-credentials">
    <label>{t("{provider} API 키", { provider: providerName(provider) })}
      <input type="password" autoComplete="off" autoCapitalize="none" spellCheck={false}
        aria-label={t("{provider} API 키", { provider: providerName(provider) })}
        value={key} minLength={12} maxLength={512} disabled={disabled || busy} onChange={event => setKey(event.target.value)} />
    </label>
    <div className="provider-credential-actions">
      <button type="button" disabled={disabled || busy || !validProviderKey(key)} onClick={() => void act("register")}>{t("이번 실행에 키 등록")}</button>
      <button type="button" disabled={disabled || busy || !configured} onClick={() => void act("remove")}>{t("키 제거")}</button>
      <button type="button" disabled={disabled || busy} onClick={() => void act("refresh")}>{t("키 상태 새로고침")}</button>
    </div>
    <p role="status">{busy ? t("API 키 상태 확인 중…") : configured
      ? t("키 등록됨 · 실제 인증과 사용 가능 여부는 API 요청 시 확인합니다.") : t("등록된 키가 없습니다.")}</p>
    <small>{t("키는 이 분석 서버가 실행되는 동안만 보관합니다. 프로젝트·설정 파일에는 저장하지 않으며 서버 재시작 시 다시 등록해야 합니다.")}</small>
    <small>{t("키를 제거해도 이미 전송된 자료는 회수되지 않습니다.")}</small>
    {error && <p className="error-box" role="alert">{t(error)}</p>}
  </div>;
}
