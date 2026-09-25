# 미배정 감소 전략 / Speaker-assignment improvement strategy

상태: **0.3.5 소스에 첫 개발 범위인 원인·근거 보존, 보수적 경계 후보 생성, 사용자 검토·선택 적용을 구현했다.** 기존 자동 배정 임계값과 경계 보정 동작은 유지하며 새 추천을 자동 확정하지 않는다. 과거 저장 결과나 실행 중인 이전 버전의 분석에 근거를 소급 생성하지 않는다. 소스 구현은 게시·설치 완료와 별개이며 인물별 음성 비교·겹침 복원과 실제 음성의 성능 평가는 아래 후속 단계로 남아 있다.

**First scope implemented in 0.3.5 source:** retain attribution evidence, propose conservative boundary candidates, and let users review and selectively apply them. Existing automatic attribution is unchanged; proposals never assign speakers on their own. Older results are not retroactively enriched. Publication/installation is separate from source completion. Voice-reference matching, overlap recovery and real-audio accuracy evaluation remain future work.

## 0.3.5에서 구현한 범위 / Implemented first scope

- **근거·원인:** 새 분석 자막에 선택적 `speakerEvidence`를 보관한다. 검출 활동 없음·활동 중첩 부족·화자 전환·활동 겹침·음성 의심·시간 불확실·화자 구분 미실행을 구분한다. 활동 비율은 단어 시간과의 중첩량이며 화자 정답 확률이 아니다. / New results retain optional cause, activity coverage and word evidence; coverage is not calibrated speaker confidence.
- **비겹침 경계 후보:** ASR 레코드를 넘어 바로 이웃한 단어를 검토하되, 단일 검출 화자·활동과의 실제 시간 중첩·최대 0.8초 단어·200ms 이웃 간격·다른 화자 충돌 차단·비연쇄 조건을 유지한다. `speech_uncertain`·시간 불확실·겹침, 누락되거나 0.8 미만인 ASR 확률은 새 후보의 대상·근거에서 제외한다. 자막의 모든 단어가 같은 후보를 지지하는 최대 두 단어 자막에만 추천하며, 사용자가 선택한 경계 보정 허용값을 따르고 꺼짐이면 후보도 생성하지 않는다. / Review-only candidates may cross ASR record boundaries under strict activity, timing and probability gates; low/missing ASR probability is rejected, not interpreted as speaker confidence.
- **검토 화면:** `미배정 보완 검토`에서 원인별 집계·필터, 적용 가능한 추천 필터, 가상 스크롤 목록, 후보·근거 대사와 앞뒤 1.5초 듣기를 제공한다. 여러 원인은 중복 집계하며 기존 결과에 근거가 없으면 `원인 상세 없음`으로 표시한다. 새 분석·다운로드는 이 창에서 자동 실행하지 않는다. / Review causes, proposals and supporting utterances with source-audio context; old results remain explicitly unknown and no analysis starts automatically.
- **선택 적용과 보호:** 개별 체크한 후보만 화자에 적용한다. 원문·시간·기존 단어 정보는 유지하고 `수동 수정`, 검수 미완료로 표시하며 기존 실행 취소로 되돌릴 수 있다. 수동 수정·검수 완료·이미 배정된 대상은 제외한다. 적용 전에 대상·근거의 원문·시간·화자를 저장 스냅샷과 비교하고, 검토 중 프로젝트/세션 변경·삭제된 근거·새로 끼어든 자막·불확실하거나 생략된 근거도 거절한다. 전체 분석 결과 교체 경로를 재사용하지 않는다. / Apply only explicitly checked proposals, revalidate source snapshots and project/session state, preserve manual work and support undo.
- **저장 경계:** 추가 근거에는 배열·문자열 상한과 크기 예산을 둔다. 필요하면 일반 단어 상세부터 줄이고 생략 표시를 남기며, 원문·시간·단어·메모는 삭제하지 않는다. 적용에 필요한 상세가 없어지면 추천을 적용할 수 없고 생략한 활동을 `활동 없음`으로 해석하지 않는다. 기존 메모 때문에 프로젝트 8MiB 한도를 넘는 경우에도 선택적 근거를 먼저 축약하고 알린다. / Optional evidence is bounded and reduced before original editing data; omitted evidence is not negative evidence.

구현 근거: [후보 생성](../backend/voicesubsep/speaker_evidence.py), [프로젝트 근거 형식](../src/speakerEvidence.ts), [선택 적용 보호](../src/speakerReview.ts), [검토 화면](../src/components/SpeakerReviewDialog.tsx). 합성 결과의 규칙·저장·보호·실행 취소 검사와 실제 브라우저의 필터→선택 적용→실행 취소 흐름을 확인했다. **실제 음성에서 미배정이 얼마나 감소하는지, 새 배정이 얼마나 정확한지, 검수 시간이 얼마나 줄었는지는 아직 측정하지 않았다.**

Synthetic rule, persistence, protection and undo tests, plus browser filter/apply/undo checks, passed. They do **not** establish reduced unassignment, speaker accuracy or review-time savings on real recordings.

## 실제 결과에서 확인한 문제

사용자가 보여 준 1시간 50분 28.9초 분석 결과의 저장본을 읽기 전용으로 집계했다. 음성·자막 본문·개인별 이름은 이 문서에 포함하지 않는다.

| 항목 | 자막 수 |
| --- | ---: |
| 전체 | 3,323 |
| 미배정 | 985 (29.6%) |
| 미배정 중 겹침 표시 | 493 |
| 미배정 중 시간 모호성 표시, 겹침 없음 | 5 |
| 미배정 중 위 두 표시 없음 | 487 |

487개 중 147개는 0.8초 이하, 421개는 1.5초 이하이다. 이 가운데 앞뒤 바로 인접한 두 자막이 같은 인물이고 양쪽 간격이 각각 200ms 이하인 사례는 201개였다. 시간 모호성·경계 보정이 붙은 인접 자막은 이 집계의 근거에서 제외했다. 이것은 검토 후보 수이며, 201개를 올바르게 자동 배정할 수 있다는 증거가 아니다. 짧은 추임새를 다른 인물이 끼워 말할 수 있다.

조사한 기존 저장 결과에는 원본 화자 활동 구간과 점수가 없다. 따라서 487개를 '활동 검출 누락'과 '활동은 있지만 시간 중첩 비율 부족'으로 정확히 나누거나, 겹침 493개가 모두 실제 동시 발화인지 확인할 수 없다. 새 근거 형식이 생겼어도 이 과거 결과를 복원한 것은 아니다. 원음 청취 없이 현재 집계만으로 배정 정확도를 주장하지 않는다.

## 유지한 기존 자동 배정과 한계

`backend/voicesubsep/inference.py`의 `_attribute`는 단어 시간의 60% 이상을 한 화자의 검출 활동이 차지하고 다음 화자가 20% 미만일 때 배정한다. 서로 다른 화자의 검출 활동이 단어 안에서 1μs를 넘게 겹치면 단어 전체를 미배정 처리한다. 이는 모델이 검출한 시간 구간이지 실제 발화의 정답은 아니므로 작은 경계 오차도 겹침으로 번질 수 있다.

`_compensate_speaker_boundaries`는 최대 0.8초인 미배정 단어 중 검출 활동과 겹치는 화자가 하나뿐이고, 같은 ASR 레코드의 바로 앞뒤 중 200ms 이내에 엄격 배정 조건을 통과한 단어가 있을 때 보정을 검토한다. **기본 500ms는 ‘단어 길이 − 해당 화자의 검출 활동과 겹친 시간’의 최대 허용량**이다. 이웃을 찾는 거리나 양쪽으로 늘리는 시간이 아니며, 800ms를 선택해도 이웃 간격 200ms·단어 길이 0.8초 제한은 그대로이다. 활동 중첩이 전혀 없거나 ASR 레코드가 다르면 보정하지 않는다.

현재 보정은 다음 보호 조건도 갖는다. 보정 전 단어 목록을 사용해 이미 보정한 단어가 다시 근거가 되는 연쇄 배정을 막는다. 바로 이웃한 단어의 시간이 겹치거나 200ms 이내의 배정된 이웃이 다른 화자이면 보정하지 않는다. 후보와 근거 단어 사이에 다른 화자의 검출 활동이 있는 근거도 사용하지 않는다. 따라서 ‘가까운 앞사람 이름을 채우는 기능’과 다르다.

**`speech_uncertain`은 기존 `_compensate_speaker_boundaries`의 보정 제외 조건이 아니다.** `_attribute` 뒤에 음성 확인 필요 표시를 붙이며, 기존 경계 보정은 대상·근거의 `overlap`·`timing`·`unassigned` 여부를 확인하지만 `speech_uncertain`이나 낮은 ASR 확률 자체로 거절하지 않는다. 보정된 자막에도 해당 경고와 검수 미완료 상태는 유지된다. 엄격 시간 조건을 통과한 근거 단어가 사람이 음성을 확인한 단어라는 뜻은 아니다. 반면 **0.3.5의 별도 추천 생성·선택 적용은 `speech_uncertain`과 낮거나 없는 확률을 거절**한다. 기존 자동 배정과 더 보수적인 검토용 추천의 계약을 구분해야 한다.

현재 `src/App.tsx`의 일반 **결과 적용**은 새 자막 목록으로 전체를 교체한다. 0.3.5의 **선택한 후보 적용**은 별도 경로에서 선택한 미배정의 화자만 바꾸고 수동 수정을 보호한다. 이 보호가 일반 전체 결과 적용의 의미까지 바꾼 것은 아니다.

## 단계별 상태와 다음 순서

1. **원인·근거 보존: 구현, 실음성 기준선은 미완료.** 새 결과의 원인·중첩량·판정 방식과 후보 근거를 저장한다. 다음은 원음으로 확인한 표본과 오배정·미배정 기준선을 확보하는 일이다. 기존 결과는 상세 없음으로 유지한다.
2. **검토·변경분 적용 보호: 구현.** 원인·추천 필터, 앞뒤 1.5초 듣기, 선택 적용, 수동 작업 보호, 오래된 후보 거절과 실행 취소를 제공한다. 충분한 근거가 없는 자막은 자동 채우지 않는다.
3. **비겹침 경계 보완: 검토용 후보로 구현, 자동 확정·선택 구간 재정렬은 미구현.** ASR 레코드를 넘는 엄격 근거와 불확실성 제외 조건을 검사한다. 사람 검수 표본에서 오배정을 측정한 뒤에만 자동화 확대를 검토한다. ASR 확률을 화자 신뢰도로 해석하지 않는다.
4. **인물별 확인 음성 비교: 후속 제안.** 사용자가 확인한 깨끗한 단독 발화 여러 구간으로 음성 특성 기준을 만들고 미배정 구간을 비교한다. 짧은 추임새와 점수 차가 작은 후보는 사람이 듣고 결정한다. 새 모델·성능·라이선스·배포 크기 검증이 필요한 별도 단계이며 현재 추천은 이런 음성 임베딩 비교를 사용하지 않는다.
5. **겹침 복원: 후속 제안.** 미세한 경계 겹침과 지속적인 동시 발화를 원음 표본으로 구분한다. 우세 화자에게 일괄 배정하지 않는다. 분리된 원본 트랙이 있으면 기존 트랙 매핑을 우선 활용한다. 음성 분리·다중 대사 복원은 독립 평가 대상으로 남긴다.

## 검증 기준

- 위 분류마다 실제 음성 표본을 먼저 확인한다. 같은 인물 사이에 다른 인물의 추임새, 긴 침묵, 무음 환각, 2명 동시 발화, 배경음, ASR 레코드 경계를 포함한다.
- 단순 미배정 비율과 함께 새로 배정한 자막의 오배정률, 시간 가중 비율, 후보 수락률, 수동 검수 시간을 측정한다. 문장을 잘게 나누어 미배정 비율만 좋아 보이는 것을 방지한다.
- 음성 기준을 만든 구간과 평가 구간을 분리한다. 정답을 확인하지 않은 사용자 결과로 정확도 목표를 달성했다고 판단하지 않는다.
- 전후 결과를 비교하고 변경된 자막만 검토할 수 있게 한다. 기준 모델·설정·원인·변경 내역을 보존한다.
- `speech_uncertain` 후보·근거, 낮거나 누락된 확률, 이미 보정된 근거, 이웃의 다른 화자·겹친 시간, ASR 레코드 경계를 넘는 경우를 각각 검사한다. 구현한 선택 적용이 수동 배정·검수 완료·편집 중인 자막을 덮지 않고 실행 취소되는 회귀 검사를 유지한다.

첫 범위의 소스 구현은 **원인 집계 → 검토 후보 표시·변경분 적용 보호 → 비겹침 경계의 선택 보완**까지이다. 아직 없는 실음성 정답 표본·오배정 측정을 확보한 뒤에만 자동화 확대를 검토하며, 인물별 음성 비교와 겹침 복원은 독립 검증 후 확장한다. 보정값을 일괄 800ms로 올리거나 앞사람 이름을 전부 채우는 방식은 기본 전략으로 사용하지 않는다. 이 문서의 후속 단계는 제안이며 과거 저장 결과를 자동 변경하지 않는다.
