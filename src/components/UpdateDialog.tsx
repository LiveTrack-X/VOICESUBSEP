import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '../desktop';
import { Dialog } from './Dialog';

const labels: Record<UpdateStatus['state'], string> = {
  unconfigured: '업데이트 배포 준비 중', idle: '업데이트를 확인할 수 있습니다', checking: '새 버전 확인 중…',
  available: '새 버전이 있습니다', 'not-available': '최신 버전입니다', downloading: '업데이트 다운로드 중…',
  downloaded: '설치할 준비가 되었습니다', installing: '업데이트를 설치합니다…', error: '업데이트를 완료하지 못했습니다',
};
export function UpdateDialog({onClose}:{onClose:()=>void}) {
  const [status,setStatus]=useState<UpdateStatus|null>(null); const [error,setError]=useState('');
  useEffect(()=>{ const bridge=window.voicesubsepDesktop; if(!bridge)return; let alive=true;
    void bridge.updateStatus().then(s=>{if(alive)setStatus(s)}).catch(e=>{if(alive)setError(String(e))});
    const unsubscribe=bridge.onUpdateStatus(s=>{if(alive)setStatus(s)}); return()=>{alive=false;unsubscribe()};
  },[]);
  async function act(kind:'checkUpdate'|'downloadUpdate'|'installUpdate') {
    try {setError('');const s=await window.voicesubsepDesktop?.[kind]();if(s)setStatus(s)}catch(e){setError((e as Error).message)}
  }
  return <Dialog title="앱 업데이트" onClose={onClose} closeDisabled={status?.state==='installing'}>
    <p className="dialog-intro">VOICESUBSEP {status?.currentVersion ?? ''}</p>
    <h3 aria-live="polite">{status ? (status.state === 'installing' && status.message ? status.message : labels[status.state]) : '버전 정보를 확인하고 있습니다…'}</h3>
    {status?.availableVersion&&<p>새 버전 {status.availableVersion}</p>}
    {status?.state==='unconfigured'&&<p>현재 설치본에는 업데이트 배포 경로가 연결되지 않았습니다. 업데이트가 설정된 새 설치본을 한 번 수동 설치하면 앱 안에서 후속 버전을 받을 수 있습니다.</p>}
    {status?.state==='downloading'&&<progress className="update-progress" value={status.progress ?? 0} max={100}/>}
    {status?.state==='downloaded'&&<p className="info-box">설치하면 앱이 재시작됩니다. 프로젝트를 저장하고 진행 중인 분석을 마친 뒤 설치하세요. 다운로드한 음성 모델은 유지됩니다.</p>}
    {(error||status?.error)&&<p role="alert" className="error-box">{error||status?.error}</p>}
    <div className="dialog-actions"><button onClick={onClose} disabled={status?.state==='installing'}>닫기</button>
      {status?.state==='available'?<button className="primary" onClick={()=>void act('downloadUpdate')}><Download size={16}/>다운로드</button>
      :status?.state==='downloaded'?<button className="primary" onClick={()=>void act('installUpdate')}>설치하고 재시작</button>
      :<button className="primary" disabled={!status?.configured||['checking','downloading','installing'].includes(status.state)} onClick={()=>void act('checkUpdate')}><RefreshCw size={16}/>업데이트 확인</button>}
    </div>
  </Dialog>;
}
