export type ConsistencyLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type CodeClarity = 'CLEAR' | 'AMBIGUOUS' | 'MISLEADING';

export interface StabilityScore {
  consistencyScore: number; // 0-100
  consistencyLevel: ConsistencyLevel;
  mainIdea: string;
  variations: Array<{ aspect: string; values: string[]; frequency: number }>;
  reasoning: string;
  codeClarity: CodeClarity;
  coverage?: {
    schemaCoverage: number; // 0-100
    specificity: number; // 0-100 (higher = more concrete, fewer ambiguous words)
    specificityModel?: number; // 0-100 (Transformers zero-shot based)
  };
}

interface MR {
  primaryPurpose?: string;
  inputs?: string[];
  outputs?: string[];
  sideEffects?: string[];
  keyBehaviors?: string[];
  invariants?: string[];
  defaults?: Record<string, number | string | boolean | null>;
  normalization?: Array<{ from: string; to: string }>;
  limits?: Array<{ name: string; min?: string | number; max?: string | number; unit?: string }>;
  constants?: string[];
  errorConditions?: string[];
  unknowns?: string[];
}

function tryParseJsonLike(raw: string): any | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    // fenced json
    const fence = raw.match(/```json\n([\s\S]+?)\n```/i);
    if (fence) {
      try {
        return JSON.parse(fence[1]);
      } catch {
        // attempt lenient fixes on fenced content
        const fixed = fence[1]
          .replace(/\u2019/g, "'") // curly apostrophe to straight
          .replace(/'([^']*)'/g, '"$1"') // single-quoted to double
          .replace(/,\s*([}\]])/g, '$1'); // trailing commas
        try {
          return JSON.parse(fixed);
        } catch {
          // ignore
        }
      }
    }
    // nearest object
    const obj = raw.match(/\{[\s\S]*\}/);
    if (obj) {
      try {
        return JSON.parse(obj[0]);
      } catch {
        // lenient fixes on nearest object
        const fixed = obj[0]
          .replace(/\u2019/g, "'")
          .replace(/'([^']*)'/g, '"$1"')
          .replace(/,\s*([}\]])/g, '$1');
        try {
          return JSON.parse(fixed);
        } catch {
          // ignore
        }
      }
    }
  }
  return undefined;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`"'.,:;!?()\[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

function tokensFromList(list: string[] | undefined): string[] {
  const out: string[] = [];
  for (const item of list || []) out.push(...tokenize(String(item)));
  return out;
}

// Ambiguous language detection for specificity scoring
const AMBIGUOUS_TERMS = new Set<string>([
  'maybe','might','possibly','could','should','often','usually','typically','around','about','approximately','roughly','some','various','several','few','sometimes'
]);

function countAmbiguousTerms(text: string): number {
  return tokenize(text).reduce((acc, t) => acc + (AMBIGUOUS_TERMS.has(t) ? 1 : 0), 0);
}

function numberLikeCount(text: string): number {
  const m = String(text).match(/-?\d+(?:\.\d+)?/g);
  return m ? m.length : 0;
}

function boolLikeCount(text: string): number {
  const m = tokenize(text).filter((t) => t === 'true' || t === 'false' || t === 'on' || t === 'off');
  return m.length;
}

function computeSpecificity(mr: MR): number {
  const fieldsAsText: string[] = [];
  if (mr.primaryPurpose) fieldsAsText.push(mr.primaryPurpose);
  for (const f of [mr.inputs, mr.outputs, mr.sideEffects, mr.keyBehaviors, mr.invariants, mr.constants, mr.errorConditions]) {
    for (const v of (f as string[] | undefined) || []) fieldsAsText.push(String(v));
  }
  if (mr.normalization) {
    for (const r of mr.normalization) fieldsAsText.push(`${r.from} -> ${r.to}`);
  }
  if (mr.limits) {
    for (const l of mr.limits) fieldsAsText.push(`${l.name}:${l.min ?? ''}-${l.max ?? ''}${l.unit ? ' ' + l.unit : ''}`);
  }
  if (mr.defaults) {
    for (const [k, v] of Object.entries(mr.defaults)) fieldsAsText.push(`${k}=${v}`);
  }

  // Heuristic: more numeric/bool literals increase specificity; ambiguous terms decrease it.
  let nums = 0;
  let bools = 0;
  let amb = 0;
  for (const t of fieldsAsText) {
    nums += numberLikeCount(t);
    bools += boolLikeCount(t);
    amb += countAmbiguousTerms(t);
  }
  const signal = nums + bools; // concrete signals
  const penalty = amb;
  // Normalize to 0-100 with diminishing returns
  const raw = (Math.atan(signal / 3) / (Math.PI / 2)) * 100; // 0..100
  const penaltyPct = Math.min(30, penalty * 5); // cap 30%
  return Math.max(0, Math.min(100, Math.round(raw - penaltyPct)));
}

function computeSchemaCoverage(mr: MR): number {
  // Consider the extended concrete fields in Phase 1
  const slots: Array<[string, unknown]> = [
    ['defaults', mr.defaults],
    ['normalization', mr.normalization],
    ['limits', mr.limits],
    ['constants', mr.constants],
    ['errorConditions', mr.errorConditions],
  ];
  let filled = 0;
  let total = 0;
  for (const [name, val] of slots) {
    total += 1;
    let hasContent = false;
    if (Array.isArray(val)) hasContent = val.length > 0;
    else if (val && typeof val === 'object') hasContent = Object.keys(val as object).length > 0;
    else hasContent = !!val;
    if (hasContent) filled += 1;
  }
  if (total === 0) return 0;
  return Math.round((filled / total) * 100);
}

type Vector = Map<string, number>; // sparse TF-IDF

// Stopwords for variations display only (does not affect scoring)
const DISPLAY_STOPWORDS = new Set<string>([
  'a','an','the','and','or','to','of','for','in','on','with','without','by','from','is','are','be','as','at','it','this','that','these','those','into','via','over','under'
]);

function isNumericToken(t: string): boolean {
  return /^\d+$/.test(t);
}

function isNoisyTokenForDisplay(t: string): boolean {
  if (!t) return true;
  if (t.length <= 2) return true;
  if (isNumericToken(t)) return true;
  if (DISPLAY_STOPWORDS.has(t)) return true;
  return false;
}

function buildTfIdfVectors(docsTokens: string[][]): Vector[] {
  const n = docsTokens.length;
  if (n === 0) return [];

  // document frequency
  const df = new Map<string, number>();
  for (const tokens of docsTokens) {
    const uniq = new Set(tokens);
    for (const t of uniq) df.set(t, (df.get(t) || 0) + 1);
  }
  // idf with smoothing
  const idf = new Map<string, number>();
  for (const [t, f] of df.entries()) {
    const val = Math.log((n + 1) / (f + 1)) + 1; // [1, ...)
    idf.set(t, val);
  }

  // tf-idf vectors
  const vectors: Vector[] = [];
  for (const tokens of docsTokens) {
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec: Vector = new Map();
    for (const [t, f] of tf) vec.set(t, f * (idf.get(t) || 1));
    vectors.push(vec);
  }
  return vectors;
}

function cosine(a: Vector, b: Vector): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  // dot product over smaller map
  let dot = 0;
  let na = 0;
  let nb = 0;
  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  for (const [t, va] of small) {
    const vb = large.get(t);
    if (vb) dot += va * vb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function averagePairwiseCosine(vectors: Vector[]): number {
  const n = vectors.length;
  if (n <= 1) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      total += cosine(vectors[i], vectors[j]);
      pairs += 1;
    }
  }
  return pairs ? total / pairs : 1;
}

// --- Inconsistency penalty (numbers/constants) helpers ---
function extractNumbers(text: string): Set<string> {
  const nums = new Set<string>();
  const re = /-?\d+(?:\.\d+)?/g;
  const m = String(text).match(re);
  if (m) for (const v of m) nums.add(v);
  return nums;
}

const CONST_TOKENS = new Set<string>([
  'true', 'false', 'enabled', 'disabled', 'on', 'off',
  'utc', 'local', 'asc', 'desc', 'ascending', 'descending'
]);

function extractConstants(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    if (CONST_TOKENS.has(t)) out.add(t);
  }
  return out;
}

function computeInconsistencyPenalty(
  texts: string[],
  // pairwise similarity function over indices (i,j) -> [0,1]
  simAt: (i: number, j: number) => number,
  options: { threshold: number; maxPenalty: number },
): number {
  const n = texts.length;
  if (n <= 1) return 0;
  let conflicts = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = simAt(i, j);
      if (s >= options.threshold) {
        const numsA = extractNumbers(texts[i]);
        const numsB = extractNumbers(texts[j]);
        const constA = extractConstants(texts[i]);
        const constB = extractConstants(texts[j]);

        let numericConflict = false;
        if (numsA.size && numsB.size) {
          let inter = 0;
          for (const v of numsA) if (numsB.has(v)) inter += 1;
          numericConflict = inter === 0; // no shared number
        }

        let constConflict = false;
        if (constA.size && constB.size) {
          let inter = 0;
          for (const v of constA) if (constB.has(v)) inter += 1;
          constConflict = inter === 0; // no shared constant
        }

        if (numericConflict || constConflict) conflicts += 1;
      }
      pairs += 1;
    }
  }
  if (!pairs) return 0;
  const ratio = conflicts / pairs;
  return Math.min(options.maxPenalty, ratio * options.maxPenalty);
}

function modeString(values: string[]): string {
  const normToOriginal: Record<string, string> = {};
  const counts: Record<string, number> = {};
  for (const v of values) {
    const norm = normalizeText(v);
    normToOriginal[norm] ??= v.trim();
    counts[norm] = (counts[norm] || 0) + 1;
  }
  let best = '';
  let bestCount = -1;
  for (const [norm, cnt] of Object.entries(counts)) {
    if (cnt > bestCount) {
      best = normToOriginal[norm];
      bestCount = cnt;
    }
  }
  return best;
}

function buildVariations(mrs: MR[]): Array<{ aspect: string; values: string[]; frequency: number }> {
  const results: Array<{ aspect: string; values: string[]; frequency: number }> = [];

  // primaryPurpose disagreements
  const ppCounts: Record<string, number> = {};
  for (const mr of mrs) {
    const key = normalizeText(mr.primaryPurpose || '');
    ppCounts[key] = (ppCounts[key] || 0) + 1;
  }
  const uniquePP = Object.keys(ppCounts).filter((k) => k.length > 0);
  if (uniquePP.length > 1) {
    const entries = Object.entries(ppCounts).sort((a, b) => b[1] - a[1]);
    for (const [val, freq] of entries.slice(0, 3)) {
      results.push({ aspect: 'primaryPurpose', values: [val], frequency: freq });
    }
  }

  // For list aspects, include items that are not shared by all responses
  const listAspects: Array<keyof MR> = ['inputs', 'outputs', 'sideEffects', 'keyBehaviors', 'invariants'];
  for (const aspect of listAspects) {
    const perRespSets = mrs.map((mr) => new Set(tokensFromList((mr[aspect] as string[] | undefined) || [])));
    const allItems = new Set<string>();
    for (const s of perRespSets) for (const x of s) allItems.add(x);
    const counts: Record<string, number> = {};
    for (const item of allItems) {
      counts[item] = perRespSets.reduce((acc, s) => acc + (s.has(item) ? 1 : 0), 0);
    }
    const variantItems = Object.entries(counts)
      .filter(([val, _c]) => !isNoisyTokenForDisplay(val))
      .filter(([, c]) => c !== perRespSets.length) // not present in all
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (variantItems.length > 0) {
      for (const [val, freq] of variantItems) {
        results.push({ aspect: String(aspect), values: [val], frequency: freq });
      }
    }
  }
  return results;
}

export function scoreStability(responses: string[]): StabilityScore {
  // Parse input MRs
  const mrs: MR[] = responses
    .map((r) => tryParseJsonLike(String(r)))
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({
      primaryPurpose: typeof v.primaryPurpose === 'string' ? v.primaryPurpose : '',
      inputs: Array.isArray(v.inputs) ? v.inputs.map(String) : [],
      outputs: Array.isArray(v.outputs) ? v.outputs.map(String) : [],
      sideEffects: Array.isArray(v.sideEffects) ? v.sideEffects.map(String) : [],
      keyBehaviors: Array.isArray(v.keyBehaviors) ? v.keyBehaviors.map(String) : [],
      invariants: Array.isArray(v.invariants) ? v.invariants.map(String) : [],
      defaults: v && typeof v === 'object' && v.defaults && typeof v.defaults === 'object' ? (v.defaults as Record<string, any>) : {},
      normalization: Array.isArray((v as any).normalization)
        ? ((v as any).normalization as any[])
            .map((x) => (x && typeof x === 'object' ? { from: String((x as any).from ?? ''), to: String((x as any).to ?? '') } : undefined))
            .filter(Boolean) as Array<{ from: string; to: string }>
        : [],
      limits: Array.isArray((v as any).limits)
        ? ((v as any).limits as any[])
            .map((x) =>
              x && typeof x === 'object'
                ? {
                    name: String((x as any).name ?? ''),
                    min: (x as any).min,
                    max: (x as any).max,
                    unit: (x as any).unit ? String((x as any).unit) : undefined,
                  }
                : undefined,
            )
            .filter(Boolean) as Array<{ name: string; min?: string | number; max?: string | number; unit?: string }>
        : [],
      constants: Array.isArray((v as any).constants) ? (v as any).constants.map(String) : [],
      errorConditions: Array.isArray((v as any).errorConditions) ? (v as any).errorConditions.map(String) : [],
      unknowns: Array.isArray((v as any).unknowns) ? (v as any).unknowns.map(String) : [],
    }));

  if (mrs.length === 0) {
    return {
      consistencyScore: 0,
      consistencyLevel: 'LOW',
      mainIdea: '',
      variations: [],
      reasoning: 'No valid MR responses could be parsed.',
      codeClarity: 'MISLEADING',
      coverage: { schemaCoverage: 0, specificity: 0 },
    };
  }

  // Build TF-IDF vectors for each field across responses and compute average pairwise cosine
  const ppVectors = buildTfIdfVectors(mrs.map((mr) => tokenize(mr.primaryPurpose || '')));
  const inputsVectors = buildTfIdfVectors(mrs.map((mr) => tokensFromList(mr.inputs)));
  const outputsVectors = buildTfIdfVectors(mrs.map((mr) => tokensFromList(mr.outputs)));
  const seVectors = buildTfIdfVectors(mrs.map((mr) => tokensFromList(mr.sideEffects)));
  const kbVectors = buildTfIdfVectors(mrs.map((mr) => tokensFromList(mr.keyBehaviors)));
  const invVectors = buildTfIdfVectors(mrs.map((mr) => tokensFromList(mr.invariants)));

  const fieldScores = {
    primaryPurpose: averagePairwiseCosine(ppVectors),
    inputs: averagePairwiseCosine(inputsVectors),
    outputs: averagePairwiseCosine(outputsVectors),
    sideEffects: averagePairwiseCosine(seVectors),
    keyBehaviors: averagePairwiseCosine(kbVectors),
    invariants: averagePairwiseCosine(invVectors),
  };

  // Apply numeric/constant inconsistency penalties on selected fields (display-only filters do not affect this)
  const texts = {
    inputs: mrs.map((m) => (m.inputs || []).join(' ')),
    outputs: mrs.map((m) => (m.outputs || []).join(' ')),
    keyBehaviors: mrs.map((m) => (m.keyBehaviors || []).join(' ')),
    invariants: mrs.map((m) => (m.invariants || []).join(' ')),
  } as const;

  function simFromVectors(vs: Vector[]) {
    return (i: number, j: number) => cosine(vs[i], vs[j]);
  }

  const penalties = {
    // caps chosen for good balance; keep overall within reasonable sensitivity
    inputs: computeInconsistencyPenalty(texts.inputs, simFromVectors(inputsVectors), { threshold: 0.6, maxPenalty: 0.10 }),
    outputs: computeInconsistencyPenalty(texts.outputs, simFromVectors(outputsVectors), { threshold: 0.6, maxPenalty: 0.10 }),
    keyBehaviors: computeInconsistencyPenalty(texts.keyBehaviors, simFromVectors(kbVectors), { threshold: 0.6, maxPenalty: 0.15 }),
    invariants: computeInconsistencyPenalty(texts.invariants, simFromVectors(invVectors), { threshold: 0.6, maxPenalty: 0.15 }),
  } as const;

  fieldScores.inputs = Math.max(0, fieldScores.inputs - penalties.inputs);
  fieldScores.outputs = Math.max(0, fieldScores.outputs - penalties.outputs);
  fieldScores.keyBehaviors = Math.max(0, fieldScores.keyBehaviors - penalties.keyBehaviors);
  fieldScores.invariants = Math.max(0, fieldScores.invariants - penalties.invariants);

  // Weighted average across fields (emphasize purpose and key behaviors)
  const WEIGHTS = {
    primaryPurpose: 0.25,
    keyBehaviors: 0.30,
    inputs: 0.15,
    outputs: 0.15,
    sideEffects: 0.10,
    invariants: 0.05,
  } as const;

  const overall =
    fieldScores.primaryPurpose * WEIGHTS.primaryPurpose +
    fieldScores.keyBehaviors * WEIGHTS.keyBehaviors +
    fieldScores.inputs * WEIGHTS.inputs +
    fieldScores.outputs * WEIGHTS.outputs +
    fieldScores.sideEffects * WEIGHTS.sideEffects +
    fieldScores.invariants * WEIGHTS.invariants;

  const score = Math.round(overall * 100);
  const level: ConsistencyLevel = score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';

  // Derivations
  const mainIdea = modeString(mrs.map((m) => m.primaryPurpose || '').filter(Boolean));

  const variations = buildVariations(mrs);

  // Code clarity aligned with overall level, with special case for extremely low primary purpose agreement
  const ppAgree = fieldScores.primaryPurpose;
  let codeClarity: CodeClarity;
  if (level === 'HIGH') codeClarity = 'CLEAR';
  else if (level === 'MEDIUM') codeClarity = 'AMBIGUOUS';
  else codeClarity = 'MISLEADING';
  if (ppAgree < 0.35 && codeClarity !== 'MISLEADING') {
    codeClarity = codeClarity === 'CLEAR' ? 'AMBIGUOUS' : 'MISLEADING';
  }

  const reasoningParts: string[] = [];
  reasoningParts.push(
    `Primary purpose agreement ${(ppAgree * 100).toFixed(0)}%; overall ${(overall * 100).toFixed(0)}%.`,
  );
  if (variations.length > 0) {
    const aspects = Array.from(new Set(variations.map((v) => v.aspect))).slice(0, 3);
    reasoningParts.push(`Disagreements in: ${aspects.join(', ')}.`);
  } else {
    reasoningParts.push('Minor differences only.');
  }

  // Coverage/specificity: compute from the modal MR (best-effort)
  const modalIndex = 0; // simple heuristic: first parsed MR
  const cov: { schemaCoverage: number; specificity: number; specificityModel?: number } = {
    schemaCoverage: computeSchemaCoverage(mrs[modalIndex] || {}),
    specificity: computeSpecificity(mrs[modalIndex] || {}),
  };

  return {
    consistencyScore: score,
    consistencyLevel: level,
    mainIdea,
    variations,
    reasoning: reasoningParts.join(' '),
    codeClarity,
    coverage: cov,
  };
}

// --- Embedding-based scorer (optional) ---
// Uses @xenova/transformers to compute sentence embeddings per field
// and average pairwise cosine similarity. Requires network on first run
// to download the model.
export async function scoreStabilityEmbedding(responses: string[]): Promise<StabilityScore> {
  // Reuse MR parsing/derivation logic from TF-IDF path
  const mrs: MR[] = responses
    .map((r) => tryParseJsonLike(String(r)))
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({
      primaryPurpose: typeof v.primaryPurpose === 'string' ? v.primaryPurpose : '',
      inputs: Array.isArray(v.inputs) ? v.inputs.map(String) : [],
      outputs: Array.isArray(v.outputs) ? v.outputs.map(String) : [],
      sideEffects: Array.isArray(v.sideEffects) ? v.sideEffects.map(String) : [],
      keyBehaviors: Array.isArray(v.keyBehaviors) ? v.keyBehaviors.map(String) : [],
      invariants: Array.isArray(v.invariants) ? v.invariants.map(String) : [],
    }));

  if (mrs.length === 0) {
    return {
      consistencyScore: 0,
      consistencyLevel: 'LOW',
      mainIdea: '',
      variations: [],
      reasoning: 'No valid MR responses could be parsed.',
      codeClarity: 'MISLEADING',
    };
  }

  // Lazy ESM import: ensure we don't transpile to require() under CJS
  // Use Function('m', 'return import(m)') trick to preserve dynamic import
  const mod: any = await (Function('m', 'return import(m)'))('@xenova/transformers');
  const { pipeline } = mod;
  const modelName = process.env.AI_COMP_TEST_EMBED_MODEL || 'Xenova/all-mpnet-base-v2';
  // quantized model to keep it light
  const extractor: any = await pipeline('feature-extraction', modelName, { quantized: true });

  async function embed(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (const t of texts) {
      const output: any = await extractor(t || '');
      // output.data is a Float32Array of shape [seq_len, hidden_size]; mean-pool across tokens
      const arr = output.data; // Float32Array
      const shape = output.dims as number[]; // [seq_len, hidden]
      const seqLen = shape[0] || 0;
      const hidden = shape[1] || 0;
      if (!seqLen || !hidden) {
        vectors.push(new Array(384).fill(0));
        continue;
      }
      const pooled = new Array(hidden).fill(0);
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < hidden; j++) pooled[j] += arr[i * hidden + j];
      }
      for (let j = 0; j < hidden; j++) pooled[j] /= seqLen;
      vectors.push(pooled);
    }
    return vectors;
  }

  function avgPairwiseCosineDense(vecs: number[][]): number {
    const n = vecs.length;
    if (n <= 1) return 1;
    let total = 0;
    let pairs = 0;
    const norms = vecs.map((v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dot = 0;
        const vi = vecs[i];
        const vj = vecs[j];
        for (let k = 0; k < vi.length && k < vj.length; k++) dot += vi[k] * vj[k];
        total += dot / (norms[i] * norms[j]);
        pairs += 1;
      }
    }
    return pairs ? total / pairs : 1;
  }

  // Prepare per-field texts
  const primaryTexts = mrs.map((m) => m.primaryPurpose || '');
  const inputsTexts = mrs.map((m) => (m.inputs || []).join(' '));
  const outputsTexts = mrs.map((m) => (m.outputs || []).join(' '));
  const seTexts = mrs.map((m) => (m.sideEffects || []).join(' '));
  const kbTexts = mrs.map((m) => (m.keyBehaviors || []).join(' '));
  const invTexts = mrs.map((m) => (m.invariants || []).join(' '));

  // Compute embeddings
  const [ppVecs, inVecs, outVecs, seVecs, kbVecs, invVecs] = await Promise.all([
    embed(primaryTexts),
    embed(inputsTexts),
    embed(outputsTexts),
    embed(seTexts),
    embed(kbTexts),
    embed(invTexts),
  ]);

  const fieldScores = {
    primaryPurpose: avgPairwiseCosineDense(ppVecs),
    inputs: avgPairwiseCosineDense(inVecs),
    outputs: avgPairwiseCosineDense(outVecs),
    sideEffects: avgPairwiseCosineDense(seVecs),
    keyBehaviors: avgPairwiseCosineDense(kbVecs),
    invariants: avgPairwiseCosineDense(invVecs),
  };

  // Apply numeric/constant inconsistency penalties on selected fields
  const texts = {
    inputs: inputsTexts,
    outputs: outputsTexts,
    keyBehaviors: kbTexts,
    invariants: invTexts,
  } as const;

  function simFromDense(vs: number[][]) {
    const norms = vs.map((v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1);
    return (i: number, j: number) => {
      let dot = 0;
      const vi = vs[i];
      const vj = vs[j];
      for (let k = 0; k < vi.length && k < vj.length; k++) dot += vi[k] * vj[k];
      const denom = norms[i] * norms[j];
      return denom ? dot / denom : 0;
    };
  }

  const penalties = {
    inputs: computeInconsistencyPenalty(texts.inputs, simFromDense(inVecs), { threshold: 0.7, maxPenalty: 0.10 }),
    outputs: computeInconsistencyPenalty(texts.outputs, simFromDense(outVecs), { threshold: 0.7, maxPenalty: 0.10 }),
    keyBehaviors: computeInconsistencyPenalty(texts.keyBehaviors, simFromDense(kbVecs), { threshold: 0.7, maxPenalty: 0.15 }),
    invariants: computeInconsistencyPenalty(texts.invariants, simFromDense(invVecs), { threshold: 0.7, maxPenalty: 0.15 }),
  } as const;

  fieldScores.inputs = Math.max(0, fieldScores.inputs - penalties.inputs);
  fieldScores.outputs = Math.max(0, fieldScores.outputs - penalties.outputs);
  fieldScores.keyBehaviors = Math.max(0, fieldScores.keyBehaviors - penalties.keyBehaviors);
  fieldScores.invariants = Math.max(0, fieldScores.invariants - penalties.invariants);

  const WEIGHTS = {
    primaryPurpose: 0.25,
    keyBehaviors: 0.30,
    inputs: 0.15,
    outputs: 0.15,
    sideEffects: 0.10,
    invariants: 0.05,
  } as const;

  const overall =
    fieldScores.primaryPurpose * WEIGHTS.primaryPurpose +
    fieldScores.keyBehaviors * WEIGHTS.keyBehaviors +
    fieldScores.inputs * WEIGHTS.inputs +
    fieldScores.outputs * WEIGHTS.outputs +
    fieldScores.sideEffects * WEIGHTS.sideEffects +
    fieldScores.invariants * WEIGHTS.invariants;

  const score = Math.round(overall * 100);
  const level: ConsistencyLevel = score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';

  const mainIdea = modeString(mrs.map((m) => m.primaryPurpose || '').filter(Boolean));
  const variations = buildVariations(mrs);

  const ppAgree = fieldScores.primaryPurpose;
  let codeClarity: CodeClarity;
  if (level === 'HIGH') codeClarity = 'CLEAR';
  else if (level === 'MEDIUM') codeClarity = 'AMBIGUOUS';
  else codeClarity = 'MISLEADING';
  if (ppAgree < 0.35 && codeClarity !== 'MISLEADING') {
    codeClarity = codeClarity === 'CLEAR' ? 'AMBIGUOUS' : 'MISLEADING';
  }

  const reasoningParts: string[] = [];
  reasoningParts.push(
    `Primary purpose agreement ${(ppAgree * 100).toFixed(0)}%; overall ${(overall * 100).toFixed(0)}%.`,
  );
  if (variations.length > 0) {
    const aspects = Array.from(new Set(variations.map((v) => v.aspect))).slice(0, 3);
    reasoningParts.push(`Disagreements in: ${aspects.join(', ')}.`);
  } else {
    reasoningParts.push('Minor differences only.');
  }

  // Coverage/specificity via model (optional)
  let cov: { schemaCoverage: number; specificity: number; specificityModel?: number } | undefined;
  try {
    const modalIndex = 0;
    const parsed = mrs[modalIndex] || {};
    const { ambiguityScores, mrToText } = await import('./ambiguity');
    const text = mrToText(parsed);
    const scores = await ambiguityScores(text);
    cov = {
      schemaCoverage: computeSchemaCoverage(parsed as any),
      specificity: computeSpecificity(parsed as any),
      specificityModel: scores.specific,
    };
  } catch {
    // ignore
  }

  // Optionally blend in model ambiguity as part of score
  let finalScore = score;
  let finalLevel: ConsistencyLevel = level;
  if ((process.env.AI_COMP_TEST_AMBIGUITY === 'model' || process.env.AI_COMP_TEST_AMBIGUITY === 'hybrid') && cov?.specificityModel != null && process.env.AI_COMP_TEST_INCLUDE_AMBIGUITY_IN_SCORE === '1') {
    const w = Math.min(0.5, Math.max(0, Number(process.env.AI_COMP_TEST_AMBIGUITY_WEIGHT || '0.15')));
    finalScore = Math.round(score * (1 - w) + (cov!.specificityModel as number) * w);
    finalLevel = finalScore >= 75 ? 'HIGH' : finalScore >= 50 ? 'MEDIUM' : 'LOW';
  }

  return {
    consistencyScore: finalScore,
    consistencyLevel: finalLevel,
    mainIdea,
    variations,
    reasoning: reasoningParts.join(' '),
    codeClarity,
    coverage: cov,
  };
}
