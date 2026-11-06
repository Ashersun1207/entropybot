export type AvatarImageProvider = "openai" | "xai" | "custom";

export interface ImageGenerationConfig {
  provider?: AvatarImageProvider;
  /** An OpenAI key; never sent to another provider. */
  key?: string;
  customApiKey?: string;
  customUrl?: string;
  customModel?: string;
}

/** A deliberately configured provider endpoint, never a provider-returned URL.
 * Local HTTP is useful for self-hosted routers; internet endpoints require TLS. */
export function normalizeProviderEndpointUrl(value: string): string {
  const message = "Use an HTTPS API base URL, or HTTP for a local router, without passwords, query parameters or fragments";
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(message); }
  if (value.length > 2048 || url.username || url.password || url.search || url.hash) throw new Error(message);
  const host = url.hostname.toLowerCase();
  const ipv4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || host === "host.docker.internal" || host === "host.containers.internal"
    || host === "[::1]" || /^\[f[cd][0-9a-f]{2}:/.test(host)
    || (ipv4 && (Number(ipv4[1]) === 127 || Number(ipv4[1]) === 10
      || (Number(ipv4[1]) === 192 && Number(ipv4[2]) === 168)
      || (Number(ipv4[1]) === 172 && Number(ipv4[2]) >= 16 && Number(ipv4[2]) <= 31)));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error(message);
  if ((ipv4 && (Number(ipv4[1]) === 0 || (Number(ipv4[1]) === 169 && Number(ipv4[2]) === 254)))
    || /^\[(?:fe[89ab][0-9a-f]:|::ffff:)/.test(host) || host === "[fd00:ec2::254]"
    || host === "metadata.google.internal" || host === "metadata.goog") throw new Error(message);
  return url.toString().replace(/\/+$/, "");
}

export function normalizeImageGenerationUrl(value: string): string {
  return normalizeProviderEndpointUrl(value).replace(/\/images\/generations$/, "");
}
