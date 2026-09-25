import { useEffect, useRef, useState } from "react";
import type { Speaker } from "../domain";
import { useI18n } from "../i18n";
import { timelineNameKeyAction } from "../timelineSpeakerName";

export function TimelineSpeakerName({ speaker, onRename }: {
  speaker: Speaker;
  onRename: (id: string, originalName: string, name: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({ original: speaker.name, value: speaker.name });
  const settled = useRef(false);
  useEffect(() => { setDraft({ original: speaker.name, value: speaker.name }); }, [speaker.id, speaker.name]);
  function finish(value: string, cancel: boolean) {
    if (settled.current) return;
    settled.current = true;
    if (cancel || draft.original !== speaker.name) setDraft({ original: speaker.name, value: speaker.name });
    else if (value !== speaker.name) onRename(speaker.id, draft.original, value);
  }
  return <input
    className="timeline-speaker-name"
    type="text"
    maxLength={80}
    aria-label={t("{name} 인물 이름 편집", { name: speaker.name || t("인물") })}
    title={t("인물 이름 편집 · Enter 또는 바깥 클릭으로 저장 · Escape로 취소")}
    placeholder={t("인물")}
    value={draft.original === speaker.name ? draft.value : speaker.name}
    onFocus={() => { settled.current = false; setDraft({ original: speaker.name, value: speaker.name }); }}
    onChange={event => setDraft({ original: speaker.name, value: event.currentTarget.value })}
    onBlur={event => finish(event.currentTarget.value, false)}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      const action = timelineNameKeyAction(event.nativeEvent);
      if (!action) return;
      event.preventDefault();
      finish(event.currentTarget.value, action === "cancel");
      event.currentTarget.blur();
    }}
  />;
}
