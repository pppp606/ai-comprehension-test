import type { Pipeline, ZeroShotClassificationOutput } from '@xenova/transformers';

let zscPipelinePromise: Promise<Pipeline> | null = null;

async function getZeroShotPipeline(): Promise<Pipeline> {
  if (!zscPipelinePromise) {
    const mod: any = await (Function('m', 'return import(m)'))('@xenova/transformers');
    const { pipeline } = mod;
    const modelName = process.env.AI_COMP_TEST_AMBIGUITY_MODEL || 'Xenova/distilbert-base-uncased-mnli';
    zscPipelinePromise = pipeline('zero-shot-classification', modelName, { quantized: true });
  }
  return zscPipelinePromise as unknown as Pipeline;
}

function splitSentences(text: string): string[] {
  return String(text)
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function avg(nums: number[]): number { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0; }

export async function ambiguityScores(text: string): Promise<{ ambiguous: number; specific: number }> {
  const clf = await getZeroShotPipeline();
  const labels = ['ambiguous', 'specific'];
  const sents = splitSentences(text);
  const outputs: ZeroShotClassificationOutput[] = [] as any;
  for (const s of sents.length ? sents : ['']) {
    const out: any = await clf(s, labels, { hypothesis_template: 'This answer is {}.' });
    outputs.push(out);
  }
  const amb = avg(outputs.map((o: any) => o.scores[o.labels.indexOf('ambiguous')] || 0));
  const spc = avg(outputs.map((o: any) => o.scores[o.labels.indexOf('specific')] || 0));
  return { ambiguous: Math.round(amb * 100), specific: Math.round(spc * 100) };
}

export function mrToText(mr: any): string {
  if (!mr || typeof mr !== 'object') return '';
  const parts: string[] = [];
  if (mr.primaryPurpose) parts.push(String(mr.primaryPurpose));
  for (const k of ['keyBehaviors', 'invariants', 'outputs', 'sideEffects', 'constants', 'errorConditions']) {
    const v = (mr as any)[k];
    if (Array.isArray(v)) parts.push(v.map(String).join(', '));
  }
  if (mr.defaults && typeof mr.defaults === 'object') {
    parts.push(Object.entries(mr.defaults).map(([k, v]) => `${k}=${v}`).join(', '));
  }
  if (Array.isArray(mr.limits)) {
    parts.push(mr.limits.map((l: any) => `${l.name}:${l.min ?? ''}-${l.max ?? ''}${l.unit ? l.unit : ''}`).join(', '));
  }
  if (Array.isArray(mr.normalization)) {
    parts.push(mr.normalization.map((r: any) => `${r.from}->${r.to}`).join(', '));
  }
  return parts.filter(Boolean).join('. ');
}

