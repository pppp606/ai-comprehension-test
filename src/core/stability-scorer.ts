export type ConsistencyLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type CodeClarity = 'CLEAR' | 'AMBIGUOUS' | 'MISLEADING';

export interface StabilityScore {
  consistencyScore: number; // 0-100
  consistencyLevel: ConsistencyLevel;
  mainIdea: string;
  variations: Array<{ aspect: string; values: string[]; frequency: number }>;
  reasoning: string;
  codeClarity: CodeClarity;
}

interface MR {
  primaryPurpose?: string;
  inputs?: string[];
  outputs?: string[];
  sideEffects?: string[];
  keyBehaviors?: string[];
  invariants?: string[];
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
        // ignore
      }
    }
    // nearest object
    const obj = raw.match(/\{[\s\S]*\}/);
    if (obj) {
      try {
        return JSON.parse(obj[0]);
      } catch {
        // ignore
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

type Vector = Map<string, number>; // sparse TF-IDF

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

  // Equal weights across six fields
  const overall =
    (fieldScores.primaryPurpose +
      fieldScores.inputs +
      fieldScores.outputs +
      fieldScores.sideEffects +
      fieldScores.keyBehaviors +
      fieldScores.invariants) /
    6;

  const score = Math.round(overall * 100);
  const level: ConsistencyLevel = score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';

  // Derivations
  const mainIdea = modeString(mrs.map((m) => m.primaryPurpose || '').filter(Boolean));

  const variations = buildVariations(mrs);

  // Heuristic code clarity using primaryPurpose agreement and overall
  const ppAgree = fieldScores.primaryPurpose;
  let codeClarity: CodeClarity;
  if (ppAgree >= 0.8 && overall >= 0.7) codeClarity = 'CLEAR';
  else if (ppAgree < 0.4 || overall < 0.4) codeClarity = 'MISLEADING';
  else codeClarity = 'AMBIGUOUS';

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

  return {
    consistencyScore: score,
    consistencyLevel: level,
    mainIdea,
    variations,
    reasoning: reasoningParts.join(' '),
    codeClarity,
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

  // Lazy import to avoid adding heavy deps to non-embedding runs
  const { pipeline } = await import('@xenova/transformers');
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

  const overall =
    (fieldScores.primaryPurpose +
      fieldScores.inputs +
      fieldScores.outputs +
      fieldScores.sideEffects +
      fieldScores.keyBehaviors +
      fieldScores.invariants) /
    6;

  const score = Math.round(overall * 100);
  const level: ConsistencyLevel = score >= 75 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW';

  const mainIdea = modeString(mrs.map((m) => m.primaryPurpose || '').filter(Boolean));
  const variations = buildVariations(mrs);

  const ppAgree = fieldScores.primaryPurpose;
  let codeClarity: CodeClarity;
  if (ppAgree >= 0.8 && overall >= 0.7) codeClarity = 'CLEAR';
  else if (ppAgree < 0.4 || overall < 0.4) codeClarity = 'MISLEADING';
  else codeClarity = 'AMBIGUOUS';

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

  return {
    consistencyScore: score,
    consistencyLevel: level,
    mainIdea,
    variations,
    reasoning: reasoningParts.join(' '),
    codeClarity,
  };
}
