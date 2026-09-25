import { MAX_TIME_SECONDS, type Caption, type Project } from "./domain";
import { editCaption } from "./editorOperations";

export type TimelineTarget = { kind: "caption" | "note"; id: string };
export type TimelineMenuAnchor = { x: number; y: number; trigger: HTMLElement };
export function timelineTarget(project: Project, target: TimelineTarget) {
  return target.kind === "caption" ? project.captions.find(item => item.id === target.id) : project.notes.find(item => item.id === target.id);
}

/** Preserve interval length. Near EOF, show and use the latest fitting start. */
export function timelineMovePlan(project: Project, target: TimelineTarget, position: number) {
  const item = timelineTarget(project, target);
  if (!item || !Number.isFinite(position)) return null;
  const limit = project.duration > 0 ? Math.min(project.duration, MAX_TIME_SECONDS) : MAX_TIME_SECONDS;
  const length = item.end === null ? 0 : item.end - item.start;
  if (!Number.isFinite(length) || length < 0 || length > limit) return null;
  const requested = Math.max(0, Math.round(position * 1000) / 1000);
  const start = Math.min(requested, limit - length);
  const changed = Math.abs(start - item.start) > 1e-9;
  const end = !changed ? item.end : item.end === null ? null : start === limit - length ? limit : start + length;
  return { start, end, adjusted: start !== requested, changed };
}

export function moveTimelineTarget(project: Project, target: TimelineTarget, position: number): Project {
  const plan = timelineMovePlan(project, target, position);
  if (!plan?.changed) return project;
  if (target.kind === "note") return { ...project, notes: project.notes.map(note => note.id === target.id ? { ...note, start: plan.start, end: plan.end } : note) };
  if (plan.end === null) return project;
  return { ...project, captions: project.captions.map(caption => caption.id === target.id ? editCaption(caption, { start: plan.start, end: plan.end! }) : caption) };
}

export function deleteTimelineTarget(project: Project, target: TimelineTarget): Project {
  if (!timelineTarget(project, target)) return project;
  return target.kind === "note" ? { ...project, notes: project.notes.filter(note => note.id !== target.id) }
    : { ...project, captions: project.captions.filter(caption => caption.id !== target.id) };
}

export function timelineMenuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return {
    left: Math.max(8, Math.min(Number.isFinite(x) ? x : 8, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(Number.isFinite(y) ? y : 8, viewportHeight - height - 8)),
  };
}

export function timelineMenuAnchor(trigger: HTMLElement, point?: { clientX: number; clientY: number }): TimelineMenuAnchor {
  const box = trigger.getBoundingClientRect();
  return { trigger, x: point ? point.clientX : box.left + Math.min(box.width / 2, 100), y: point ? point.clientY : box.bottom };
}

/** Dense canvas lanes retain a real target without selecting/seeking first. */
export function captionAtTimelinePosition(captions: readonly Caption[], position: number, selected: string | null, tolerance = 0): Caption | undefined {
  const near = (caption: Caption) => position >= caption.start - tolerance && position <= caption.end + tolerance;
  const active = (caption: Caption) => caption.start <= position && position < caption.end;
  return captions.find(caption => caption.id === selected && active(caption))
    ?? captions.find(active)
    ?? captions.filter(near).sort((a, b) => Math.min(Math.abs(a.start - position), Math.abs(a.end - position)) - Math.min(Math.abs(b.start - position), Math.abs(b.end - position)))[0];
}
