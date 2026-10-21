const UPSTREAM_ORIGIN = "https://liubai-ledger-cloud-v2-preview.vercel.app";

function rewrittenLocation(value, publicOrigin) {
  if (!value) return value;
  try {
    const url = new URL(value, UPSTREAM_ORIGIN);
    if (url.origin === UPSTREAM_ORIGIN) {
      return `${publicOrigin}${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return value;
  }
  return value;
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const upstream = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM_ORIGIN);
    const headers = new Headers(request.headers);

    headers.delete("host");
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;

    const response = await fetch(upstream, init);
    const outHeaders = new Headers(response.headers);
    const location = outHeaders.get("location");
    if (location) outHeaders.set("location", rewrittenLocation(location, incoming.origin));
    outHeaders.set("x-liubai-edge", "cloudflare");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: outHeaders,
    });
  },
};
