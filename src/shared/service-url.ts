/** Private service data travels over HTTPS, or HTTP only to a server on this computer. */
export function safeBaseUrl(text: string): boolean {
  try {
    const url = new URL(text);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}
