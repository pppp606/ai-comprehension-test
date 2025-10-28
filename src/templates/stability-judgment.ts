interface StabilityJudgmentTemplateOptions {
  originalQuestion: string;
  code: string;
  responses: string[];
}

export function buildStabilityJudgmentPrompt(options: StabilityJudgmentTemplateOptions): string {
  const { originalQuestion, code, responses } = options;
  const labelled = responses
    .map((response, index) => `Response ${index + 1}: ${response}`)
    .join('\n');

  return [
    'You have access to the entire project codebase as context.',
    '',
    'Each response is a JSON “meaning representation” (MR) of the same code/question. Judge semantic consistency of understanding, ignoring wording/formatting.',
    '',
    '## Original Question',
    `"${originalQuestion}"`,
    '',
    '## Target Code',
    '```typescript',
    code,
    '```',
    '',
    '## Responses (JSON per line)',
    labelled,
    '',
    '## Evaluation Instructions',
    '- Parse each response as JSON with fields: primaryPurpose, inputs, outputs, sideEffects, keyBehaviors, invariants.',
    '- Determine if they describe the SAME functionality: same primary purpose; similar inputs/outputs; compatible side-effects; overlapping key behaviors; compatible invariants.',
    '- Ignore stylistic phrasing and list ordering; focus on conceptual overlap.',
    '',
    'Consistency scale:',
    '- HIGH: All (or all but one) responses align on primaryPurpose and agree on most inputs/outputs/behaviors; differences are minor granularity/synonyms.',
    '- MEDIUM: Mixed agreement; at least two distinct interpretations or significant omissions/conflicts in multiple fields.',
    '- LOW: Multiple conflicting interpretations; primaryPurpose differs or fields contradict each other broadly.',
    '',
    'Respond ONLY with strict JSON (double quotes, no comments, no trailing commas).',
    'Example (format only, values are illustrative):',
    '{',
    '  "consistencyScore": 78,',
    '  "consistencyLevel": "HIGH",',
    '  "mainIdea": "Summarized primary responsibility",',
    '  "variations": [ { "aspect": "inputs", "values": ["req"], "frequency": 2 } ],',
    '  "reasoning": "Most responses agree on purpose; minor differences in inputs.",',
    '  "codeClarity": "CLEAR"',
    '}',
    'Now output your result as strict JSON only (no markdown, no prose):',
    '{',
    '  "consistencyScore": number,                  // 0-100',
    '  "consistencyLevel": "HIGH" | "MEDIUM" | "LOW",',
    '  "mainIdea": string,                          // canonicalized primary purpose',
    '  "variations": [ { "aspect": string, "values": string[], "frequency": number } ],',
    '  "reasoning": string,                         // 1-2 sentences explaining conflicts or alignment',
    '  "codeClarity": "CLEAR" | "AMBIGUOUS" | "MISLEADING"',
    '}'
  ].join('\n');
}
