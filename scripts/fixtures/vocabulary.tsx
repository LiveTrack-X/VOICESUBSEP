import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AnalysisDialog } from "../../src/components/AnalysisDialog";
import { I18nProvider } from "../../src/i18n";
import { createProject, parseProject, serializeProject, type Project } from "../../src/domain";
import { defaultAnalysisPreferences, saveAnalysisPreferences } from "../../src/settings";

const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate: () => boolean, message: string) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(); }
  throw new Error(`${message}: ${document.body.textContent?.slice(-1200)}`);
}
const button = (text: string) => Array.from(document.querySelectorAll("button")).find(item => item.textContent === text)!;
function input(element: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLTextAreaElement ? "input" : "change", { bubbles: true }));
}
const initial = createProject(1);
initial.duration = 2; initial.mediaName = "synthetic.wav"; initial.mediaIdentity = { sha256: "c".repeat(64), bytes: 8 };
initial.vocabulary = ["Old"];
initial.captions = [{ id: "manual", start: 0, end: 1, text: "수동 편집 유지", speakerId: "speaker-1", reviewed: true, reasons: ["edited"] }];
const originalCaptions = JSON.stringify(initial.captions), jobs: Record<string, unknown>[] = [], errors: string[] = [];
const portableCaptions = JSON.stringify(parseProject(serializeProject(initial)).captions);
const file = new File(["fixture!"], "synthetic.wav", { type: "audio/wav" });
let current: Project = initial;
let changeProject: (terms: string[]) => void;
console.error = (...args) => errors.push(args.map(String).join(" "));
window.fetch = async (input, init) => {
  const path = String(input);
  check(path.startsWith("/api/"), "No external request is permitted");
  const body = path === "/api/health" ? { status: "ok", ffmpeg: true, ffprobe: true, engines: { whisper: true, nemotron: true, qwen: true } }
    : path === "/api/media" ? { id: "a".repeat(32), name: file.name, duration: 2, bytes: 8, sha256: initial.mediaIdentity!.sha256, url: `/api/media/${"a".repeat(32)}/file`, audioTracks: [{ index: 0, label: "Audio 1", channels: 1 }] }
    : path === "/api/history" ? { items: [] }
    : path === "/api/provider-credentials" ? Object.fromEntries(["groq", "xai", "gemini", "deepgram"].map(name => [name, { configured: true }]))
    : path === "/api/vst/status" ? { available: false }
    : path === "/api/vst/plugins" ? { plugins: [], roots: [] }
    : path === "/api/jobs" && init?.method === "POST" ? (jobs.push(JSON.parse(String(init.body))), { id: "b".repeat(32) })
    : path === `/api/jobs/${"b".repeat(32)}` ? { id: "b".repeat(32), status: "queued", stage: "queued", progress: 0 }
    : null;
  check(body, `Unexpected request ${path}`);
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
function Harness() {
  const [project, setProject] = useState(initial);
  current = project;
  changeProject = terms => setProject(previous => ({ ...previous, vocabulary: terms }));
  return <I18nProvider><AnalysisDialog file={file} project={project} onClose={() => {}} onApply={() => { throw new Error("Unexpected caption replacement"); }} onVocabularySave={terms => setProject(previous => ({ ...previous, vocabulary: terms }))}/></I18nProvider>;
}
async function run() {
  localStorage.clear(); saveAnalysisPreferences({ ...defaultAnalysisPreferences(), diarization: false, device: "cpu" });
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<Harness/>));
  await until(() => !!document.querySelector(".vocabulary-editor textarea"), "Vocabulary editor unavailable");
  const textarea = () => document.querySelector<HTMLTextAreaElement>(".vocabulary-editor textarea")!;
  input(textarea(), " 젠야타 \ncafe\u0301\ncafé");
  await until(() => !button("프로젝트에 저장").disabled, "Save never enabled");
  check(button("전사만 시작").disabled, "Unsaved terms must block analysis");
  button("프로젝트에 저장").click();
  await until(() => textarea().value === "젠야타\ncafé" && !button("전사만 시작").disabled, "Save did not normalize/update project");
  check(JSON.stringify(current.vocabulary) === JSON.stringify(["젠야타", "café"]), "Wrong saved terms");
  check(JSON.stringify(parseProject(serializeProject(current)).captions) === portableCaptions, "Manual captions changed");
  input(textarea(), "bad\tterm");
  await until(() => textarea().getAttribute("aria-invalid") === "true", "Invalid terms not detected");
  check(button("프로젝트에 저장").disabled, "Invalid save remained enabled");
  input(textarea(), "젠야타\ncafé");
  await until(() => !button("전사만 시작").disabled, "Reverting draft did not unblock");
  const provider = document.querySelector<HTMLSelectElement>('select[aria-label="음성 인식 제공자"]')!;
  input(provider, "gemini");
  await until(() => document.body.textContent!.includes("이번 외부 요청에는 전송하지 않습니다."), "Gemini disclosure missing");
  input(provider, "xai");
  const consent = () => document.querySelector<HTMLInputElement>(".cloud-consent input")!;
  await until(() => !!consent() && !consent().disabled, "Cloud credentials never ready");
  consent().click(); await until(() => consent().checked, "Consent did not enable");
  input(textarea(), "젠야타\nD.Va");
  await until(() => !button("프로젝트에 저장").disabled, "Edited terms not saveable");
  button("프로젝트에 저장").click();
  await until(() => !consent().checked, "Saving terms did not revoke consent");
  check(jobs.length === 0, "Editing/saving started analysis");
  consent().click(); await until(() => consent().checked, "Consent did not reenable");
  flushSync(() => changeProject(["리퍼"]));
  await until(() => !consent().checked && textarea().value === "리퍼", "Project term change did not reset consent");
  consent().click(); await until(() => !button("전사만 시작").disabled, "Explicit consent did not unblock");
  button("전사만 시작").click();
  await until(() => jobs.length === 1, "No analysis request");
  check(JSON.stringify(jobs[0].vocabulary) === JSON.stringify(["리퍼"]), "Job omitted saved term snapshot");
  check(jobs[0].cloudConsent === true && jobs[0].asrProvider === "xai", "Job consent/provider wrong");
  check(JSON.stringify(current.captions) === originalCaptions, "Analysis enqueue changed manual captions");
  flushSync(() => root.unmount());
  check(errors.length === 0, `React errors: ${errors.join(" ")}`);
  return { savedAndRoundtripped: true, unsavedBlocked: true, invalidBlocked: true, unsupportedDisclosed: true, consentRevokedOnSaveAndProjectChange: true, explicitRequestSnapshot: true, manualCaptionsPreserved: true, jobs: jobs.length };
}
(window as unknown as { vocabularyResult: Promise<unknown> }).vocabularyResult = run();
