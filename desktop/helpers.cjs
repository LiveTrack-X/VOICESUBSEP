const path = require('node:path');

const APP_URL = 'voicesubsep://app/';

function validateUpdateUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('업데이트 주소는 HTTPS URL이어야 합니다.');
  let url;
  try { url = new URL(value); } catch { throw new Error('업데이트 주소를 해석할 수 없습니다.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('업데이트 주소에는 HTTPS만 허용하며 인증 정보·쿼리·fragment를 넣을 수 없습니다.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function sameOrigin(candidate, expected) {
  try {
    const a = new URL(candidate);
    const b = new URL(expected);
    // URL.origin is "null" for a custom scheme in Node, so compare its parts.
    return !a.username && !a.password && a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
  } catch { return false; }
}

function externalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function proxyUrl(value, backendOrigin) {
  if (!sameOrigin(value, APP_URL)) throw new Error('허용하지 않은 앱 주소입니다.');
  const source = new URL(value);
  const base = new URL(backendOrigin);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port) throw new Error('백엔드는 임의 포트의 loopback 주소여야 합니다.');
  // Assign pathname, not new URL(path, base): a //host path must never change the destination host.
  base.pathname = source.pathname;
  base.search = source.search;
  base.hash = '';
  return base.href;
}

function backendPaths(resourcesPath, userData, platform = process.platform) {
  return {
    executable: path.join(resourcesPath, 'backend', platform === 'win32' ? 'voicesubsep-server.exe' : 'voicesubsep-server'),
    dataDir: path.join(userData, 'data'),
    webDir: path.join(resourcesPath, 'web'),
    logsDir: path.join(userData, 'logs'),
  };
}

function backendArguments(port, paths) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('유효한 백엔드 포트가 필요합니다.');
  return ['--port', String(port), '--data-dir', paths.dataDir, '--web-dir', paths.webDir];
}

function initialUpdateStatus(version, feed, packaged) {
  return {
    state: feed && packaged ? 'idle' : 'unconfigured',
    configured: Boolean(feed && packaged),
    currentVersion: version,
    message: !packaged ? '개발 실행에서는 업데이트를 사용할 수 없습니다.' : !feed ? '이 설치본에는 업데이트 서버가 설정되지 않았습니다.' : '업데이트 확인을 누르면 서버에 연결합니다.',
  };
}

module.exports = { APP_URL, validateUpdateUrl, sameOrigin, externalUrl, proxyUrl, backendPaths, backendArguments, initialUpdateStatus };
