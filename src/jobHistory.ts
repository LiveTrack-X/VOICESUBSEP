import { request } from "./api";

export type HistoryItem = {
  id: string; kind: "analysis" | "render"; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string; mediaId: string; mediaName: string; projectId?: string | null; projectName: string;
  progress: number; stage: string; hasResult: boolean;
};
export type CacheInfo = {items:{id:string;name:string;bytes:number;duration:number;protected:boolean}[];bytes:number;reclaimableBytes:number;freeBytes:number;maxUploadBytes:number};
export const readHistory = () => request<{items:HistoryItem[]}>("/api/history");
export const jobUrl = (item:Pick<HistoryItem,"kind"|"id">) => `/api/${item.kind === "analysis" ? "jobs" : "renders"}/${item.id}`;
export function sameAnalysisSource(item: HistoryItem, projectId: string, mediaId: string) {
  return item.kind === "analysis" && item.projectId === projectId && item.mediaId === mediaId;
}
