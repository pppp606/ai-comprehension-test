export interface MRClaim {
  defaults?: Record<string, number | string | boolean | null>;
  normalization?: Array<{ from: string; to: string }>;
  limits?: Array<{ name: string; min?: string | number; max?: string | number; unit?: string }>;
  constants?: string[];
  errorConditions?: string[];
}

export interface GroundednessResult {
  score: number; // 0-100
  mismatches: Array<{ fact: string; claim?: string; note?: string }>;
  factCoverage: number; // 0-100
}

interface ExtractedFact {
  kind: 'default' | 'limit' | 'boolean' | 'constant' | 'timeout' | 'fallback';
  key?: string;
  value?: string | number | boolean;
  min?: number;
  max?: number;
  unit?: string;
  text: string; // human-readable
}

// Very lightweight heuristic extraction from TypeScript source
export function extractFactsFromCode(code: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const src = String(code);

  // this.x = 5000;  or  this.flag = true; or this.x = expr ?? 5000;
  const assignRe = /this\.(\w+)\s*=\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = assignRe.exec(src))) {
    const key = m[1];
    const rhs = m[2].trim();
    const nullish = rhs.match(/\?\?\s*(\d+|true|false)\b/);
    if (nullish) {
      const v = nullish[1];
      if (/^\d+$/.test(v)) facts.push({ kind: 'default', key, value: Number(v), text: `default ${key}=${v}` });
      else facts.push({ kind: 'boolean', key, value: v === 'true', text: `boolean ${key}=${v}` });
    } else if (/^\d+(?:\.\d+)?$/.test(rhs)) {
      facts.push({ kind: 'default', key, value: Number(rhs), text: `default ${key}=${rhs}` });
    } else if (/^(true|false)$/.test(rhs)) {
      facts.push({ kind: 'boolean', key, value: rhs === 'true', text: `boolean ${key}=${rhs}` });
    }
  }

  // Math.min(name, 30000) / Math.max(5, name)
  const minRe = /Math\.min\(\s*([\w.]+)\s*,\s*(\d+)\s*\)/g;
  while ((m = minRe.exec(src))) {
    const v = Number(m[2]);
    facts.push({ kind: 'limit', key: m[1], max: v, text: `limit max ${m[1]}<=${v}` });
  }
  const maxRe = /Math\.max\(\s*(\d+)\s*,\s*([\w.]+)\s*\)/g;
  while ((m = maxRe.exec(src))) {
    const v = Number(m[1]);
    facts.push({ kind: 'limit', key: m[2], min: v, text: `limit min ${m[2]}>=${v}` });
  }

  // 'on'/'off' mapping in ternaries
  const onOffRe = /\?\s*true\s*:\s*false|\?\s*false\s*:\s*true|(['"])on\1|(['"])off\2/g;
  if (onOffRe.test(src)) {
    facts.push({ kind: 'constant', value: 'on/off', text: 'mapping on/off present' });
  }

  // Timeouts pattern like parseTimeout(s: string) '(\d+)(ms|s)'
  if (/parseTimeout\s*\([\s\S]*?\)[\s\S]*?\/(ms|s)\//.test(src) || /(\d+)\s*\*\s*1000/.test(src)) {
    facts.push({ kind: 'timeout', text: 'timeout normalization present', value: 's->ms' });
  }

  return facts;
}

export function computeGroundedness(code: string, claim: MRClaim): GroundednessResult {
  // Build reference MR from code via AST and simple heuristics
  let ref: any = {};
  try {
    const { extractReferenceMRFromCode } = require('./ref-extractor');
    ref = extractReferenceMRFromCode(code);
  } catch {
    // Fallback to regex-based facts if AST path fails
    const legacyFacts = extractFactsFromCode(code);
    // Convert legacy facts into a reference MR shape
    const defaults: Record<string, any> = {};
    const limits: any[] = [];
    const normalization: any[] = [];
    const constants: string[] = [];
    for (const f of legacyFacts) {
      if (f.kind === 'default' && f.key && f.value !== undefined) defaults[f.key] = f.value as any;
      if (f.kind === 'limit' && f.key) limits.push({ name: f.key, min: f.min, max: f.max });
      if (f.kind === 'timeout') normalization.push({ from: 's', to: 'ms' });
      if (f.kind === 'constant' && typeof f.value === 'string') constants.push(String(f.value));
    }
    ref = { defaults, limits, normalization, constants, errorConditions: [] };
  }

  const mismatches: Array<{ fact: string; claim?: string; note?: string }> = [];
  let total = 0;
  let matched = 0;

  function eq(a: any, b: any): boolean { return String(a) === String(b); }
  function normalizeName(name: string | undefined): string {
    if (!name) return '';
    return String(name).replace(/^this\./, '');
  }

  // Defaults
  if (ref.defaults) {
    for (const [k, v] of Object.entries(ref.defaults)) {
      total += 1;
      const c = claim.defaults || {};
      if (k in c && eq((c as any)[k], v)) {
        matched += 1;
      } else {
        // value-only partial match (allow key drift)
        const anyValMatch = Object.values(c).some((cv) => eq(cv, v));
        if (anyValMatch) matched += 1; else mismatches.push({ fact: `default ${k}=${v}`, claim: `defaults[${k}]` });
      }
    }
  }
  // Limits
  if (Array.isArray(ref.limits)) {
    for (const lim of ref.limits) {
      total += 1;
      const claimLimits = (claim.limits || []).map((l) => ({ ...l, name: normalizeName(String((l as any).name)) }));
      const limName = normalizeName(String(lim.name));
      const found = claimLimits.some((l) => String(l.name) === limName &&
        (lim.min == null || eq(l.min, l.min)) && (lim.max == null || eq(l.max, l.max)));
      if (found) {
        matched += 1;
      } else {
        // value-only partial match: any limit with same min/max
        const anyVal = claimLimits.some((l) => (lim.min != null && eq(l.min, lim.min)) || (lim.max != null && eq(l.max, lim.max)));
        if (anyVal) matched += 1; else mismatches.push({ fact: `limit ${limName}${lim.min != null ? ` min=${lim.min}` : ''}${lim.max != null ? ` max=${lim.max}` : ''}`, claim: 'limits' });
      }
    }
  }
  // Normalization
  if (Array.isArray(ref.normalization) && ref.normalization.length) {
    total += 1;
    const has = (claim.normalization || []).some((r) => /ms/.test(String(r.to)));
    if (has) matched += 1; else mismatches.push({ fact: 'normalization s->ms', claim: 'normalization' });
  }
  // Constants
  if (Array.isArray(ref.constants) && ref.constants.length) {
    total += 1;
    const has = (claim.constants || []).some((c) => ref.constants!.includes(String(c)));
    if (has) matched += 1; else mismatches.push({ fact: `constants ${ref.constants.join(',')}`, claim: 'constants' });
  }

  const factCoverage = total ? Math.round((matched / total) * 100) : 0;
  const score = factCoverage; // keep simple and interpretable
  return { score, mismatches, factCoverage };
}
