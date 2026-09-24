const { APP_URL, sameOrigin, proxyUrl } = require('./helpers.cjs');
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'";

function createProxyHandler(origin, fetchRequest) {
  return async (request) => {
    if (request.initiatorOrigin && !sameOrigin(request.initiatorOrigin, APP_URL)) return new Response('Forbidden', { status: 403 });
    const headers = new Headers(request.headers);
    const originalOrigin = headers.get('Origin');
    if (originalOrigin && !sameOrigin(originalOrigin, APP_URL)) return new Response('Forbidden', { status: 403 });
    let target;
    try { target = proxyUrl(request.url, origin); }
    catch { return new Response('Not found', { status: 404 }); }
    // The loopback transport does not add the renderer's custom-scheme Origin.
    // This canonical value is attached only after the initiator and target are validated.
    headers.set('Origin', 'voicesubsep://app');
    const response = await fetchRequest(target, { method: request.method, headers, body: request.body, duplex: 'half', redirect: 'error' });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('Content-Security-Policy', CSP);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  };
}

module.exports = { createProxyHandler };
