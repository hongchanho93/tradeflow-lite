/** Exact candidate identity shared by the three isolated user extension runtimes. */
export async function extensionSourceHash(source: string, cryptoValue: Crypto = globalThis.crypto): Promise<string> {
  if (!cryptoValue?.subtle) throw new Error('source_hash_unavailable');
  const bytes = new TextEncoder().encode(source);
  const digest = await cryptoValue.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
