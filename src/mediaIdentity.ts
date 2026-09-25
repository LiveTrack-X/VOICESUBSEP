import type { MediaInfo } from "./api";
import type { Project } from "./domain";

export type MediaIdentity={sha256:string;bytes:number};
export function parseMediaIdentity(value:unknown):MediaIdentity {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("원본 파일 검증 정보가 유효하지 않습니다.");
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>key!=="sha256"&&key!=="bytes")||typeof row.sha256!=="string"||!/^[a-f0-9]{64}$/u.test(row.sha256)||
    typeof row.bytes!=="number"||!Number.isSafeInteger(row.bytes)||row.bytes<=0)throw new Error("원본 파일 검증 정보가 유효하지 않습니다.");
  return {sha256:row.sha256,bytes:row.bytes};
}
/** Identity comes from the server's streamed upload hash, never filename/duration. */
export function uploadedMediaIdentity(media:Pick<MediaInfo,"sha256"|"bytes">,fileBytes?:number):MediaIdentity {
  const identity=parseMediaIdentity({sha256:media.sha256,bytes:media.bytes});
  if(fileBytes!==undefined&&fileBytes!==identity.bytes)throw new Error("연결한 파일과 서버의 원본 검증 정보가 다릅니다.");
  return identity;
}
export function sameMediaIdentity(first:MediaIdentity|undefined,second:MediaIdentity|undefined):boolean {
  return !!first&&!!second&&first.sha256===second.sha256&&first.bytes===second.bytes;
}
export type MediaLinkDecision="new"|"same"|"legacy"|"different";
export function mediaLinkDecision(project:Project,identity:MediaIdentity):MediaLinkDecision {
  if(project.mediaIdentity)return sameMediaIdentity(project.mediaIdentity,identity)?"same":"different";
  return project.mediaName||project.captions.length||project.notes.length||project.cuts?.length||project.documents?.items.length||project.audioMix?.tracks.length?"legacy":"new";
}
export function bindProjectMedia(project:Project,media:MediaInfo,fileName:string,allowLegacy=false):Project {
  const identity=uploadedMediaIdentity(media),decision=mediaLinkDecision(project,identity);
  if(decision==="different")throw new Error("프로젝트에 등록된 원본과 다른 파일입니다. 원본을 다시 연결하거나 새 프로젝트로 시작하세요.");
  if(decision==="legacy"&&!allowLegacy)throw new Error("이 프로젝트에는 원본 검증 정보가 없습니다. 원본을 다시 연결하고 확인하세요.");
  return {...project,mediaName:fileName,mediaIdentity:identity,duration:media.duration};
}
export function assertProjectMedia(project:Project,media:MediaInfo):void {
  if(!project.mediaIdentity)throw new Error("이 프로젝트에는 원본 검증 정보가 없습니다. 원본을 다시 연결하고 확인하세요.");
  if(!sameMediaIdentity(project.mediaIdentity,uploadedMediaIdentity(media)))throw new Error("프로젝트에 등록된 원본과 다른 파일입니다. 원본을 다시 연결하거나 새 프로젝트로 시작하세요.");
}
/** Late uploads and confirmation callbacks cannot bind to a replacement session,
 * even when the replacement reopens the exact same project ID. */
export class MediaSelectionGuard {
  private generation=0;
  begin(projectId:string){return {generation:++this.generation,projectId};}
  cancel(){this.generation++;}
  current(token:{generation:number;projectId:string},projectId:string){return token.generation===this.generation&&token.projectId===projectId;}
}
