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

function setFromList(list: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const item of list || []) {
    for (const tok of tokenize(String(item))) {
      out.add(tok);
    }
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const small = a.size < b.size ? a : b;
  const large = a.size < b.size ? b : a;
  for (const v of small) if (large.has(v)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

function averagePairwiseJaccard(sets: Set<string>[]): number {
  const n = sets.length;
  if (n <= 1) return 1;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      total += jaccard(sets[i], sets[j]);
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
    const perRespSets = mrs.map((mr) => setFromList((mr[aspect] as string[] | undefined) || []));
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

  // Build sets for each field across responses
  const ppSets = mrs.map((mr) => new Set(tokenize(mr.primaryPurpose || '')));
  const inputsSets = mrs.map((mr) => setFromList(mr.inputs));
  const outputsSets = mrs.map((mr) => setFromList(mr.outputs));
  const seSets = mrs.map((mr) => setFromList(mr.sideEffects));
  const kbSets = mrs.map((mr) => setFromList(mr.keyBehaviors));
  const invSets = mrs.map((mr) => setFromList(mr.invariants));

  const fieldScores = {
    primaryPurpose: averagePairwiseJaccard(ppSets),
    inputs: averagePairwiseJaccard(inputsSets),
    outputs: averagePairwiseJaccard(outputsSets),
    sideEffects: averagePairwiseJaccard(seSets),
    keyBehaviors: averagePairwiseJaccard(kbSets),
    invariants: averagePairwiseJaccard(invSets),
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

