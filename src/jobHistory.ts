import { request } from "./api";

export type HistoryItem = {
  id: string; kind: "analysis" | "render"; status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: string; mediaId: string; mediaName: string; projectId?: string | null; projectName: string;
  progress: number; stage: string; hasResult: boolean;
};
export type CacheInfo = {items:{id:string;name:string;bytes:number;duration:number;protected:boolean}[];bytes:number;reclaimableBytes:number;freeBytes:number};
export type CacheCleanupResult = {removedCount:number;removedBytes:number;skippedCount:number;failedCount:number};
/** Snapshot only the displayed app-owned, unreserved copies. New uploads stay out. */
export function cacheCleanupSelection(cache: CacheInfo) {
  const items = cache.items.filter(item => !item.protected).slice(0, 1000);
  return {ids: items.map(item => item.id), bytes: items.reduce((total, item) => total + item.bytes, 0)};
}
export const cleanupMediaCache = (ids: readonly string[]) => request<CacheCleanupResult>("/api/cache/cleanup", {method:"POST", body:JSON.stringify({mediaIds:ids})});
export const readHistory = () => request<{items:HistoryItem[]}>("/api/history");
export const jobUrl = (item:Pick<HistoryItem,"kind"|"id">) => `/api/${item.kind === "analysis" ? "jobs" : "renders"}/${item.id}`;
export function sameAnalysisSource(item: HistoryItem, projectId: string, mediaId: string) {
  return item.kind === "analysis" && item.projectId === projectId && item.mediaId === mediaId;
}
