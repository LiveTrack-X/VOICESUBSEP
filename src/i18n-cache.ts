export const cacheMessages: Record<string, readonly [string, string, string, string]> = {
  "정리 가능한 캐시 정리": ["Clean unused cache", "未使用キャッシュを整理", "清理未使用缓存", "Limpiar caché sin uso"],
  "캐시 정리 확인": ["Confirm cache cleanup", "キャッシュ整理の確認", "确认清理缓存", "Confirmar limpieza de caché"],
  "정리 확인": ["Confirm cleanup", "整理する", "确认清理", "Confirmar limpieza"],
  "표시한 복사본 {count}개 · {bytes}를 정리할까요? 삭제 직전에 사용 여부를 다시 확인합니다.": ["Clean these {count} cached copies ({bytes})? Usage is checked again immediately before deletion.", "表示したコピー{count}件（{bytes}）を整理しますか？削除直前に使用状況を再確認します。", "清理这 {count} 个缓存副本（{bytes}）？删除前会再次检查使用情况。", "¿Limpiar estas {count} copias ({bytes})? Se vuelve a comprobar su uso justo antes de borrarlas."],
  "자동 삭제 없이 사용하지 않는 복사본만 직접 정리합니다. 저장된 작업 결과와 모델·녹음은 유지합니다.": ["Cleanup is manual and only removes unused cached copies. Saved job results, models and recordings are kept.", "自動削除はせず、未使用のコピーのみ手動で整理します。保存済みの作業結果・モデル・録音は保持します。", "仅手动清理未使用的缓存副本，不会自动删除。保留任务结果、模型和录音。", "La limpieza es manual y solo elimina copias sin uso. Se conservan los resultados, modelos y grabaciones."],
  "캐시 {count}개 · {bytes} 정리 완료. 보호되었거나 없는 항목 {skipped}개, 정리 실패 {failed}개.": ["Cleaned {count} cached copies ({bytes}). Protected or missing: {skipped}; failed: {failed}.", "キャッシュ{count}件（{bytes}）を整理しました。保護中・削除済み{skipped}件、失敗{failed}件。", "已清理 {count} 个缓存副本（{bytes}）。受保护或不存在：{skipped}；失败：{failed}。", "Se limpiaron {count} copias ({bytes}). Protegidas o ausentes: {skipped}; fallos: {failed}."],
  "캐시를 정리하지 못했습니다. 새로고침 후 다시 시도하세요.": ["Could not clean the cache. Refresh and try again.", "キャッシュを整理できませんでした。更新して再試行してください。", "无法清理缓存。请刷新后重试。", "No se pudo limpiar la caché. Actualiza e inténtalo de nuevo."],
};
