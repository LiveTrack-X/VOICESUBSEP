import { ApiError, request, type Job } from "./api";

export function priorityRequest(job:Job, expectedRunningJobId?:string) {
  if(job.status!=="queued"||!job.queue||!job.queue.workerAvailable||!/^[a-f0-9]{32}$/u.test(job.id))throw new Error("queue-changed");
  if(expectedRunningJobId!==undefined){
    if(!/^[a-f0-9]{32}$/u.test(expectedRunningJobId)||job.queue.blockingJob?.id!==expectedRunningJobId||job.queue.blockingJob.cancelRequested)throw new Error("queue-changed");
    return {cancelRunning:true,expectedRunningJobId};
  }
  return {cancelRunning:false};
}
export async function prioritizeAnalysis(job:Job, expectedRunningJobId?:string):Promise<Job> {
  const body=priorityRequest(job,expectedRunningJobId);
  const result=await request<Job>(`/api/jobs/${job.id}/prioritize`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  if(result.id!==job.id)throw new Error("queue-changed");
  return result;
}
export function queueError(error:unknown):string {
  if(error instanceof ApiError&&error.status===503)return "분석 실행기가 준비되지 않아 순서를 바꾸지 못했습니다. 서버 상태를 확인하세요.";
  if(error instanceof ApiError&&(error.status===409||error.status===404)||error instanceof Error&&error.message==="queue-changed")return "대기열이 변경되었습니다. 최신 상태를 확인한 뒤 다시 선택하세요.";
  return "실행 순서 변경 결과를 확인하지 못했습니다. 다시 누르기 전에 최신 작업 상태를 확인하세요.";
}
