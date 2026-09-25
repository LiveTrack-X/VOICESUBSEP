import type { Project } from "./domain";

/** Match Sidebar's 80-character, empty-name-allowed policy; never rewrite caption identities. */
export function renameTimelineSpeaker(project: Project, speakerId: string, originalName: string, name: string): Project {
  const speaker = project.speakers.find(item => item.id === speakerId);
  if (!speakerId || !speaker || speaker.name !== originalName || speaker.name === name || name.length > 80) return project;
  return { ...project, speakers: project.speakers.map(item => item.id === speakerId ? { ...item, name } : item) };
}

export function timelineNameKeyAction(event: { key: string; isComposing: boolean; keyCode: number }): "commit" | "cancel" | null {
  if (event.isComposing || event.keyCode === 229) return null;
  return event.key === "Enter" ? "commit" : event.key === "Escape" ? "cancel" : null;
}
