export const textProviderMessages: Record<string, readonly [string, string, string, string]> = {
  "자막 번역": ["Subtitle translation", "字幕翻訳", "字幕翻译", "Traducción de subtítulos"],
  "AI로 회의록 초안 생성": ["Generate meeting drafts with AI", "AIで議事録の下書きを生成", "使用AI生成会议纪要草稿", "Generar borradores de actas con IA"],
  "텍스트 처리 제공자": ["Text processing provider", "テキスト処理の提供元", "文本处理提供商", "Proveedor de procesamiento de texto"],
  "로컬 Ollama": ["Local Ollama", "ローカルOllama", "本地Ollama", "Ollama local"],
  "클라우드 텍스트 모델 ID": ["Cloud text model ID", "クラウドテキストモデルID", "云端文本模型ID", "ID del modelo de texto en la nube"],
  "계정 모델 목록 조회": ["Fetch account model list", "アカウントのモデル一覧を取得", "查询账户模型列表", "Consultar modelos de la cuenta"],
  "모델 목록 조회는 자막을 보내지 않습니다. 선택한 모델의 텍스트·JSON 지원은 실행 시 확인됩니다.": ["Fetching models does not send subtitles. Text and JSON support for the selected model is checked when it runs.", "一覧の取得では字幕を送信しません。選択したモデルのテキスト・JSON対応は実行時に確認されます。", "查询模型列表不会发送字幕。所选模型是否支持文本及JSON将在运行时确认。", "Consultar modelos no envía subtítulos. La compatibilidad con texto y JSON se comprueba al ejecutar el modelo."],
  "모델 {count}개 · 입력란에서 선택하거나 ID를 직접 입력하세요.": ["{count} models · Select in the field or enter an ID.", "{count}モデル · 入力欄で選択するかIDを入力してください。", "{count}个模型 · 请在输入框中选择或直接输入ID。", "{count} modelos · Elige en el campo o introduce un ID."],
  "{provider}로 원문 자막과 인물 이름을 보내며 API 비용이 발생할 수 있음을 확인했습니다.": ["I confirm that source subtitles and speaker names may be sent to {provider} and API charges may apply.", "元の字幕と話者名を{provider}に送信し、API料金が発生する場合があることを確認しました。", "我已确认将向{provider}发送原始字幕及说话人姓名，并可能产生API费用。", "Confirmo el envío de subtítulos originales y nombres de hablantes a {provider}, con posibles cargos de API."],
  "이 기능은 자막 텍스트만 전송합니다. 원본 음성·영상 파일은 전송하지 않습니다.": ["This feature sends transcript text only. It does not upload source audio or video files.", "この機能は字幕テキストのみを送信します。元の音声・動画ファイルは送信しません。", "此功能仅发送字幕文本，不上传原始音频或视频文件。", "Esta función solo envía texto transcrito. No sube los archivos de audio o vídeo originales."],
  "클라우드 모델 목록이 올바르지 않습니다.": ["The cloud model list is invalid.", "クラウドモデルの一覧が無効です。", "云端模型列表无效。", "La lista de modelos en la nube no es válida."],
  "클라우드 텍스트 전송과 API 비용에 동의한 뒤 시작하세요.": ["Confirm cloud text transmission and API charges before starting.", "クラウドへのテキスト送信とAPI料金を確認してから開始してください。", "请先确认云端文本传输及API费用。", "Confirma el envío de texto a la nube y los cargos de API antes de empezar."],
};
