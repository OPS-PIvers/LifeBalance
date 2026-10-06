/**
 * Sound-alike repair for shopping items on the on-device engine.
 *
 * Vosk's small model has no idea what a family buys, so it writes the nearest
 * common English word: "rice" comes out as "rights" or "race", "ham" as
 * "hand". The add grammar (wallVoiceGrammar.ts) then dutifully adds "Rights".
 * Here a short, ONE-syllable word that is not a known item is matched, by how
 * it sounds, against the household's grocery catalog plus a built-in list of
 * staples, and replaced only when exactly one of them sounds the same.
 *
 * Deliberately narrow: one-syllable words only (that is where a recognizer
 * guesses wrong; "paper" vs "pepper" never collide here), never a word that is
 * itself a known item ("soap" is never turned into "soup"), and never when two
 * items fit. The add still shows its 10 s Undo, so a rare wrong guess costs a tap.
 */

/** Everyday grocery words. Base forms; plurals are matched through `singular`. */
const GROCERY_WORDS = [
  'rice', 'milk', 'egg', 'bread', 'butter', 'cheese', 'yogurt', 'cream', 'juice', 'water', 'soda', 'coffee', 'tea', 'sugar', 'salt',
  'pepper', 'flour', 'oil', 'vinegar', 'honey', 'jam', 'jelly', 'syrup', 'cereal', 'oats', 'oat', 'granola', 'pasta', 'noodle',
  'spaghetti', 'sauce', 'soup', 'broth', 'bean', 'corn', 'pea', 'carrot', 'celery', 'onion', 'garlic', 'potato', 'tomato', 'lettuce',
  'spinach', 'kale', 'cabbage', 'broccoli', 'cauliflower', 'cucumber', 'pickle', 'mushroom', 'squash', 'zucchini', 'pumpkin', 'beet',
  'radish', 'leek', 'yam', 'apple', 'banana', 'orange', 'lemon', 'lime', 'grape', 'berry', 'strawberry', 'blueberry', 'raspberry',
  'peach', 'pear', 'plum', 'cherry', 'melon', 'mango', 'pineapple', 'avocado', 'fruit', 'raisin', 'date', 'fig', 'nut', 'almond',
  'peanut', 'cashew', 'walnut', 'pecan', 'seed', 'chicken', 'beef', 'pork', 'ham', 'bacon', 'sausage', 'turkey', 'steak', 'fish',
  'salmon', 'tuna', 'shrimp', 'crab', 'lamb', 'hot dog', 'meat', 'meatball', 'tofu', 'chip', 'cracker', 'cookie', 'cake', 'pie',
  'candy', 'chocolate', 'gum', 'popcorn', 'pretzel', 'bun', 'roll', 'bagel', 'muffin', 'tortilla', 'wrap', 'pizza', 'ice cream',
  'ice', 'frozen', 'ketchup', 'mustard', 'mayo', 'salsa', 'dressing', 'spice', 'cinnamon', 'vanilla', 'yeast', 'baking soda',
  'wine', 'beer', 'cider', 'lunch', 'snack', 'treat', 'food', 'dog food', 'cat food', 'cat litter', 'bag', 'box', 'can', 'jar',
  'soap', 'towel', 'foil', 'napkin', 'tissue', 'toilet', 'trash', 'diaper', 'wipe', 'shampoo', 'floss', 'tooth', 'toothpaste', 'razor', 'lotion',
  'sponge', 'bleach', 'laundry', 'detergent', 'battery', 'bulb', 'lightbulb', 'glue', 'tape', 'stamp', 'card', 'gift', 'pet',
  'dog', 'cat', 'fish food', 'flower', 'plant', 'soil', 'charcoal', 'pop', 'cola', 'lemonade',
];

/** Words that describe or package an item. Known, so never repaired, but never a repair target either ("right" is not "red"). */
const MODIFIER_WORDS = [
  'ground', 'whole', 'fresh', 'organic', 'brown', 'white', 'red', 'green', 'yellow', 'black', 'sweet', 'dish', 'paper', 'plastic',
  'large', 'small', 'big', 'extra', 'dozen', 'half', 'more', 'some', 'other', 'with', 'from', 'that', 'this', 'them', 'than',
];

/** Words that are items on their own, never repaired into something else. */
const KNOWN_WORDS = new Set(
  [...GROCERY_WORDS, ...MODIFIER_WORDS].flatMap(w => w.split(' ')).flatMap(w => [w, w.endsWith('s') ? w : `${w}s`])
);

/** "tomatoes" → "tomato", "chips" → "chip", "peas" → "pea". */
function singularWord(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('oes') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

const VOWELS = 'aeiouy';

/** How many vowel groups a word has, ignoring a silent final e ("rice" → 1, "paper" → 2). */
function syllables(word: string): number {
  const w = word.replace(/igh/g, 'i').replace(/([^aeiouy])e$/, '$1');
  return (w.match(/[aeiouy]+/g) ?? []).length;
}

/**
 * A rough consonant skeleton: spelling quirks folded ("ph"→f, "ck"→k, soft
 * c→s, silent gh/e/w/k dropped), voiced and unvoiced stops merged (d↔t, b↔p,
 * g↔k, v↔f, z↔s), vowels dropped. "rice", "race", "rise" → "rs".
 */
function skeleton(word: string): string {
  let s = word
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/igh/g, 'i')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/^wr/, 'r')
    .replace(/^kn/, 'n')
    .replace(/^wh/, 'w')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/([^aeiouy])e$/, '$1');
  s = s.replace(/sh/g, 'S').replace(/ch/g, 'C').replace(/th/g, 'T');
  // A leading vowel or h is part of the sound ("egg" ≠ "hawk" ≠ "awk"); an h/w after the start is not.
  let out = VOWELS.includes(s[0] ?? '') ? 'a' : s[0] === 'h' ? 'h' : '';
  s = s.replace(/^h/, '').replace(/[hw]/g, '');
  s.split('').forEach(ch => {
    if (VOWELS.includes(ch)) return;
    const mapped = ({ b: 'p', d: 't', g: 'k', v: 'f', z: 's' } as Record<string, string>)[ch] ?? ch;
    if (out[out.length - 1] !== mapped) out += mapped;
  });
  return out;
}

/** The keys a heard word may be known by: as heard, and without a stop before a final s ("rights" → "rs"). */
function heardKeys(word: string): Set<string> {
  const k = skeleton(word);
  const keys = new Set([k]);
  // "rights" is "rice" with a t the recognizer put in before the s.
  if (/ts$/.test(k) && k.length > 2) keys.add(`${k.slice(0, -2)}s`);
  return keys;
}

const MIN_LENGTH = 4;

export interface SoundAlikeIndex {
  /** Skeleton → the distinct items (lower case) that sound like it. */
  bySound: Map<string, Set<string>>;
  known: Set<string>;
}

/** The household's catalog (every word of every name) plus the built-in staples. */
export function soundAlikeIndex(catalogNames: readonly string[]): SoundAlikeIndex {
  const bySound = new Map<string, Set<string>>();
  const known = new Set(KNOWN_WORDS);
  const add = (raw: string) => {
    const word = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length < MIN_LENGTH - 1) return;
    const base = singularWord(word);
    known.add(word);
    known.add(base);
    if (syllables(base) !== 1) return;
    const k = skeleton(base);
    if (!k) return;
    const set = bySound.get(k) ?? new Set<string>();
    set.add(base);
    bySound.set(k, set);
  };
  GROCERY_WORDS.flatMap(w => w.split(' ')).forEach(add);
  catalogNames.flatMap(n => n.split(/[\s,]+/)).forEach(add);
  return { bySound, known };
}

/**
 * The one item a short unfamiliar word most likely was ("rights" → "rice"), or
 * null when it's a known item, longer than a syllable, or ambiguous.
 */
export function soundAlike(word: string, index: SoundAlikeIndex): string | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < MIN_LENGTH || syllables(singularWord(w)) !== 1 || index.known.has(w) || index.known.has(singularWord(w))) return null;
  const found = new Set<string>();
  for (const k of heardKeys(w)) index.bySound.get(k)?.forEach(item => found.add(item));
  if (found.size !== 1) return null;
  const [only] = [...found];
  return only ?? null;
}
