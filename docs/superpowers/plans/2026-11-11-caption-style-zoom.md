# Caption styling and timeline detail implementation plan

**Goal:** Apply the user's feedback: choose named local fonts, customize subtitle outline/shadow, and edit beyond the existing 8x timeline limit.

**Architecture:** Extend optional project style fields without changing existing generic font categories or old project readability. Resolve inheritance consistently for preview and supported exports. Read Windows font family names through a narrow trusted desktop IPC, with manual local-font names in browser mode. Keep the timeline density canvas viewport-sized while increasing zoom to 64x and preserving the visible source-time anchor.

**Accepted scope:** The user requested these improvements. Routine bounds and controls are decided within that scope. Current uncommitted caption restructuring and speech-tool work is preserved. No release or installation is requested here.

- [x] Extend style persistence/resolution/validation and ASS export; document YTT/SRT limits.
- [x] Add named font, outline width/color and shadow controls with inherited/reset/cancel behavior and live preview.
- [x] Add explicit desktop installed-font discovery with cached, validated names; no font file access or downloads.
- [x] Increase zoom to 64x, preserve viewed time, add useful ruler ticks, and retain viewport-only density rendering.
- [x] Verify legacy projects, partial inheritance, hostile style input, exports, zoom clamping/anchoring and existing editing behavior.
- [x] Run meaningful focused and full checks, review changes independently, inspect rendered desktop/narrow views, and document tested scope.

Evidence: [source validation](../../evidence/caption-style-zoom-source-validation.json). Final frontend suite: 1,007 passed; desktop/dev: 88 passed; production web build passed. Real App/preload smoke and local ASS rendering passed. Narrow header wrapping was corrected during rendered validation. No installer or release was produced.
