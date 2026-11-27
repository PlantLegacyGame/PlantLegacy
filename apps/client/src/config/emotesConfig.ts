/**
 * Emote definitions, read from `config/emotes.json`.
 *
 * The wheel's labels and the bubble text both use this catalog, so a label is
 * edited in one place. `/config/emotes` serves the file's `emote_definitions`
 * array; the fallback is only for a client that cannot read the config at all.
 */

export interface EmoteDefinitionConfig {
  id: string;
  label: string;
}

/**
 * Last-resort copy of the shipped definitions. It exists so a 404 cannot leave
 * the player with an empty wheel; normal play always uses `/config/emotes`.
 */
export const DEFAULT_EMOTE_DEFINITIONS: readonly EmoteDefinitionConfig[] = [
  { id: 'wave', label: 'Wave' },
  { id: 'cheer', label: 'Cheer' },
  { id: 'thumbs_up', label: 'Thumbs Up' },
  { id: 'heart', label: 'Heart' },
  { id: 'think', label: 'Think' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'dance', label: 'Dance' },
  { id: 'sad', label: 'Sad' },
];

function fallbackDefinitions(): EmoteDefinitionConfig[] {
  return DEFAULT_EMOTE_DEFINITIONS.map(({ id, label }) => ({ id, label }));
}

/**
 * Normalise the config array into the one shape the wheel and chat use.
 *
 * IDs are lower-case because the server matches `/emote <id>` against the
 * lower-cased config IDs. Malformed and duplicate entries are skipped rather
 * than rendering a wedge that cannot be sent.
 */
export function normalizeEmoteDefinitions(raw: unknown): EmoteDefinitionConfig[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const definitions: EmoteDefinitionConfig[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { id?: unknown; label?: unknown };
    if (typeof record.id !== 'string') continue;
    const id = record.id.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    const label =
      typeof record.label === 'string' && record.label.trim().length > 0 ? record.label.trim() : id;
    seen.add(id);
    definitions.push({ id, label });
  }
  return definitions;
}

export async function loadEmotesConfig(serverOrigin: string): Promise<EmoteDefinitionConfig[]> {
  try {
    const response = await fetch(`${serverOrigin}/config/emotes`, { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { emote_definitions?: unknown };
      const definitions = normalizeEmoteDefinitions(data.emote_definitions);
      if (definitions.length > 0) return definitions;
    }
  } catch {
    // Fall through to the shipped fallback.
  }
  return fallbackDefinitions();
}
