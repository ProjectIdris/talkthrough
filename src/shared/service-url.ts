/** Private service data travels over HTTPS, or HTTP only to a server on this computer. */
export function safeBaseUrl(text: string): boolean {
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    const host = url.hostname; // URL canonicalizes numeric IPv4 and IPv4-mapped IPv6 first.
    if (host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host)) return true;
    const mapped = /^\[::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}\]$/.exec(host);
    return mapped !== null && (parseInt(mapped[1]!, 16) >>> 8) === 127;
  } catch {
    return false;
  }
}
