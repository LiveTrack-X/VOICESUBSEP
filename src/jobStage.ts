const labels:Record<string,string>={
  queued:"분석 대기",
  completed:"분석 결과를 확인한 뒤 적용하세요.",
  preparing:"분석을 준비하고 있습니다.",
  failed:"아래 오류 내용을 확인하세요.",
  cancelled:"작업이 취소되었습니다.",
  "cancellation requested":"현재 처리 단계가 끝나면 취소합니다.",
  interrupted:"서버가 중단되어 분석을 완료하지 못했습니다.",
};
export function jobStageLabel(stage:string):string{return Object.hasOwn(labels,stage)?labels[stage]:stage;}
