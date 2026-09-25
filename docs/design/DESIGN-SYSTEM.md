# Editor design system

Reference: editor-concept.png, generated with built-in image generation from the streamer editor brief. Adopted implementation reference, not user-approved artwork or a functional app screenshot.

- White editor surfaces, #f5f6f8 surrounding canvas, #e4e7ee dividers, #2c3442 text, #808b9a muted.
- Indigo #635bff action/selected state. Speakers purple, amber, teal, blue. No decorative photos or gradients.
- 60px header, 224-240px source/settings rail, flexible video + caption column, 288px notes panel, bottom source-time timeline, thin save status footer.
- System Korean sans (Malgun Gothic fallback), 13px controls, 14px rows, 15px panel titles, 22px wordmark. Consistent 6px control radius, 8px panel radius, 1px borders.
- Lucide outline icons, 1.8px stroke, usually 16px; video empty state 28px.
- Allowed reference copy: VOICESUBSEP, 새 프로젝트, 프로젝트 열기, 저장, 내보내기, 프로젝트, 미디어 소스, 영상 불러오기, 자막 설정, 일반 대화, 동시 발화, 참가자, 음성 분석, 전체 자막, 검수 필요, 시간, 인물, 자막, SRT 가져오기, 아직 자막이 없습니다, 편집 노트, 노트, 전체, 기억할 순간을 남겨보세요, 타임라인, 자동 저장.
- Functional extensions needed: split/merge/delete, export options, analysis progress/setup errors, undo/redo, note edit form, file relink, media playback failure. These use the same tokens and are intentional functional additions to the empty-state concept.
- Intentional changes: use 인물 A..D from domain model; no clock/date footer; no fake waveform or nonexistent timeline audio; source-time caption lanes are real data. Responsiveness stacks panels for small screens while desktop keeps editor density.

Full fidelity/interaction evidence is recorded at handoff in development status; concept is a visual reference, never a pixel-perfect correctness claim.
