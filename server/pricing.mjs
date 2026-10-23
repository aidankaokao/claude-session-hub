// API-equivalent prices in USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing
// (checked 2026-10-23). Update when new models ship; unknown models are counted but left unpriced.
// [model id prefix, input, 5m cache write, 1h cache write, cache read, output]
const PRICES = [
  ['claude-fable-5-1', 10, 12.5, 20, 0.25, 50],
  ['claude-mythos-5-1', 10, 12.5, 20, 0.25, 50],
  ['claude-fable-5', 10, 12.5, 20, 1, 50],
  ['claude-mythos-5', 10, 12.5, 20, 1, 50],
  ['claude-opus-5-5', 4, 5, 8, 0.2, 20],
  ['claude-opus-5', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-8', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-7', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-6', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-5', 5, 6.25, 10, 0.5, 25],
  ['claude-opus-4-1', 15, 18.75, 30, 1.5, 75],
  ['claude-opus-4', 15, 18.75, 30, 1.5, 75],
  ['claude-sonnet-5-5', 2, 2.5, 4, 0.1, 10],
  ['claude-sonnet-5', 2, 2.5, 4, 0.2, 10],
  ['claude-sonnet-4', 3, 3.75, 6, 0.3, 15], // 4, 4.5, 4.6
  ['claude-haiku-5-5', 0.1, 0.125, 0.2, 0.01, 0.5], // prompts over 100K: ×5, see below
  ['claude-haiku-4-5', 1, 1.25, 2, 0.1, 5],
  ['claude-3-5-haiku', 0.8, 1, 1.6, 0.08, 4],
].sort((a, b) => b[0].length - a[0].length); // longest prefix wins ("claude-opus-5-5" before "claude-opus-5")

const HAIKU_55_LONG_PROMPT = 100_000;
// Fast mode doubles every category on the models that offer it ($8/$40 vs $4/$20, $10/$50 vs $5/$25).
const FAST_MULTIPLIER = 2;
const US_ONLY_MULTIPLIER = 1.1;

export function priceFor(model) {
  if (typeof model !== 'string') return null;
  const row = PRICES.find(([prefix]) => model.startsWith(prefix));
  return row ? { input: row[1], write5m: row[2], write1h: row[3], read: row[4], output: row[5] } : null;
}

// Token counts of one API response, split the way they are billed.
export function tokensOf(u) {
  const read = u.cache_read_input_tokens ?? 0;
  const writeTotal = u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  // older transcripts have no TTL breakdown: treat writes as the default 5-minute TTL
  const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : writeTotal;
  return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, read, write5m, write1h };
}

// USD for one API response, or null when the model has no known price (e.g. a non-Claude model behind a proxy).
export function costOf(model, u) {
  const p = priceFor(model);
  if (!p) return null;
  const t = tokensOf(u);
  let m = 1;
  if (model.startsWith('claude-haiku-5-5') && t.input + t.read + t.write5m + t.write1h > HAIKU_55_LONG_PROMPT) m *= 5;
  if (u.speed === 'fast') m *= FAST_MULTIPLIER;
  if (u.inference_geo === 'us') m *= US_ONLY_MULTIPLIER;
  return (
    (m * (t.input * p.input + t.write5m * p.write5m + t.write1h * p.write1h + t.read * p.read + t.output * p.output)) /
    1_000_000
  );
}
