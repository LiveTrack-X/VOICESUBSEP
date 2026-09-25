import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n";
import { createProject } from "../../src/domain";
import { BackgroundJobDialog } from "../../src/components/BackgroundJobStatus";
import { JobHistoryDialog } from "../../src/components/JobHistoryDialog";
import type { Job } from "../../src/api";
import { runCacheProtection } from "./cache-protection";

// Real React DOM and component polling, synthetic data only. No API connection.
const legacy = new URLSearchParams(location.search).has("legacy");
const errors: string[] = [];
console.error = (...args) => { errors.push(args.map(String).join(" ")); };
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate: () => boolean, label = "React state") {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await pause(); }
  throw new Error(`Timed out waiting for ${label}`);
}
const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const button = (text: string) => Array.from(document.querySelectorAll("button")).find(item => item.textContent === text);
const polls = new Map<number, () => void>();
const interval = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
window.setInterval = ((callback: () => void, delay?: number) => {
  if (delay !== 5000) return interval(callback, delay);
  const id = 900000 + polls.size; polls.set(id, callback); return id;
}) as typeof window.setInterval;
window.clearInterval = (id?: number) => { if (id !== undefined && polls.delete(id)) return; clear(id); };
const project = createProject(2), mediaId = "b".repeat(32);
let current: Job = { id: "a".repeat(32), status: "running", progress: .1, stage: "transcribing", canForceCancel: true,
  recognitionPreview: { lines: ["Synthetic draft"], updatedAt: new Date().toISOString() } };
let mutations = 0;
window.fetch = async (input, init) => {
  if (init?.method && init.method !== "GET") { mutations++; throw new Error("Unexpected API mutation"); }
  const path = String(input).startsWith("/api/") ? String(input) : new URL(String(input), location.href).pathname;
  const body = path === "/api/cache" ? { items: [], bytes: 0, reclaimableBytes: 0, freeBytes: 1000 }
    : path === "/api/history" ? { items: [{ ...current, kind: "analysis", mediaId, mediaName: "synthetic.wav", projectId: project.id, projectName: "Synthetic", createdAt: "", hasResult: false }] }
      : path === `/api/jobs/${current.id}` ? { ...current } : null;
  if (!body) throw new Error("Unexpected request path");
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};

async function run() {
  const root = createRoot(document.getElementById("root")!);
  const counts = { backgroundMax: 0, historyMax: 0, backgroundPolls: 24, historyPolls: 24, confirmationPreserved: false, newJobReset: false, completedClean: false };
  const snapshot = () => ({ pointer: { id: current.id, projectId: project.id, projectName: "Synthetic", mediaId, mediaName: "synthetic.wav" }, job: { ...current }, paused: false, missing: false });
  const background = () => flushSync(() => root.render(<I18nProvider><BackgroundJobDialog snapshot={snapshot()} project={project} file={null} onClose={() => {}} onApply={() => { throw new Error("Unexpected result apply"); }} onRetry={() => {}} /></I18nProvider>));
  for (let i = 0; i < counts.backgroundPolls; i++) {
    current = { ...current, progress: .1 + i / 100 };
    background();
    counts.backgroundMax = Math.max(counts.backgroundMax, document.querySelectorAll(".analysis-queue").length);
    if (!legacy) {
      check(document.querySelectorAll(".analysis-queue").length === 1, "Background controls accumulated");
      check(document.querySelectorAll(".recognition-preview").length === 1, "Background draft accumulated");
    }
    await pause();
  }
  if (!legacy) {
    flushSync(() => button("작업 취소")!.click());
    background();
    counts.confirmationPreserved = document.querySelectorAll(".analysis-queue-confirm").length === 1;
    current = { ...current, id: "c".repeat(32) }; background(); await pause();
    counts.newJobReset = document.querySelectorAll(".analysis-queue-confirm").length === 0;
    current = { ...current, status: "completed", progress: 1, result: { duration: 1, captions: [], speakers: [], warnings: ["Synthetic warning"] } };
    background();
    counts.completedClean = !document.querySelector(".analysis-queue") && document.querySelectorAll(".analysis-job-details").length === 1;
    check(counts.confirmationPreserved && counts.newJobReset && counts.completedClean, "Background lifecycle failed");
  }
  flushSync(() => root.render(null)); await pause();
  current = { ...current, id: "d".repeat(32), status: "running", result: undefined, progress: .1 };
  flushSync(() => root.render(<I18nProvider><JobHistoryDialog project={project} file={null} onClose={() => {}} onApplyAnalysis={() => { throw new Error("Unexpected result apply"); }} /></I18nProvider>));
  await until(() => !!button("결과 및 진행 확인"), "history list");
  button("결과 및 진행 확인")!.click();
  await until(() => !!document.querySelector(".analysis-queue"), "history details");
  for (let i = 0; i < counts.historyPolls; i++) {
    current = { ...current, progress: .2 + i / 100 };
    for (const callback of polls.values()) callback();
    await until(() => document.querySelector<HTMLProgressElement>(".export-section progress")?.value === current.progress, `history poll ${i}`);
    counts.historyMax = Math.max(counts.historyMax, document.querySelectorAll(".analysis-queue").length);
    if (!legacy) {
      check(document.querySelectorAll(".analysis-queue").length === 1, "History controls accumulated");
      check(document.querySelectorAll(".recognition-preview").length === 1, "History draft accumulated");
    }
  }
  root.unmount();
  check(mutations === 0, "Unexpected write request");
  const duplicateWarnings = errors.filter(message => message.includes("same key")).length;
  if (!legacy) check(duplicateWarnings === 0, "Duplicate key warning");
  else check(duplicateWarnings > 0 && counts.backgroundMax > 1, `Legacy bug did not reproduce: ${JSON.stringify({ ...counts, duplicateWarnings })}`);
  const cacheProtection=legacy?null:await runCacheProtection();
  return { legacy, ...counts, duplicateWarnings, apiMutations: mutations, remainingPollTimers: polls.size, cacheProtection };
}
(window as unknown as { reconciliationResult: Promise<unknown> }).reconciliationResult = run();
