/** Stable wire alias for the existing three model protocols. This suffix is
 * not authentication; the registry still rejects any name collision. */
export function capabilityToolName(id: string): string {
  const name = id.replaceAll('.', '_');
  if (name.length <= 64) return name;
  let hash = 0xcbf29ce484222325n;
  for (const character of id) hash = BigInt.asUintN(64, (hash ^ BigInt(character.charCodeAt(0))) * 0x100000001b3n);
  return `${name.slice(0, 47)}_${hash.toString(16).padStart(16, '0')}`;
}
