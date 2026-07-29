const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function normalizeApiBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error("DM Faster API URL must be an absolute URL.", { cause });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("DM Faster API URL must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("DM Faster API URL must use HTTPS unless it is a loopback development endpoint.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("DM Faster API URL cannot include credentials, a query string, or a fragment.");
  }
  if (url.pathname !== "/") {
    throw new Error("DM Faster API URL must be an origin without a pathname.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateVerificationUrl(value: string, baseUrl: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new Error("DM Faster returned an invalid browser verification URL.", { cause });
  }
  const normalizedBase = new URL(`${normalizeApiBaseUrl(baseUrl)}/`);
  if (url.origin !== normalizedBase.origin) {
    throw new Error("DM Faster returned a browser verification URL for an unexpected origin.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("DM Faster returned an unsafe browser verification URL.");
  }
  if (!/^\/connect\/agent\/agent_auth_[a-f0-9]{32}$/.test(url.pathname)) {
    throw new Error("DM Faster returned an unexpected browser verification path.");
  }
  return url.toString();
}
