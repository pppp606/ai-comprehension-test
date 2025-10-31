interface StabilityPromptOptions {
  elementType: 'Class' | 'Method';
  name: string;
  code: string;
  question: string;
}

export function buildStabilityPrompt(options: StabilityPromptOptions): string {
  const { elementType, name, code, question } = options;
  const gamified = process.env.AI_COMP_TEST_STABILITY_PROMPT_MODE === 'gamified';
  const includeSchema = process.env.AI_COMP_TEST_INCLUDE_SCHEMA !== '0';
  const lines = [
    'You have access to the entire project codebase as context.',
    '',
    'Read the code and answer the question by returning ONLY a normalized JSON “meaning representation” (MR) that captures understanding independent of wording.',
    'Strict requirements: Output must be valid JSON (double quotes, no comments, no trailing commas), a single object, and no markdown or extra text.',
    'All required keys must be present even when unknown — do not omit keys.',
    '',
    '## Target Code',
    `${elementType}: ${name}`,
    '```typescript',
    code,
    '```',
    '',
    '## Question',
    question,
    '',
    '## Output (strict JSON, no markdown, no extra text)',
    '{',
    '  "primaryPurpose": string,                     // one-sentence essence of responsibility',
    '  "inputs": string[],                          // key inputs this unit consumes',
    '  "outputs": string[],                         // key outputs or effects it produces',
    '  "sideEffects": string[],                     // external effects (IO, network, time) or none',
    '  "keyBehaviors": string[],                    // 2-4 essential behaviors the code performs',
    '  "invariants": string[],                      // assumptions or guarantees maintained',
    '  "defaults": { [key: string]: number | string | boolean | null },  // concrete default values derived from code',
    '  "normalization": Array<{ from: string, to: string }>,             // value canonicalization rules (e.g., "2s" -> "2000ms")',
    '  "limits": Array<{ name: string, min?: string | number, max?: string | number, unit?: string }>,',
    '  "constants": string[],                        // notable fixed literals or flags (e.g., "UTC", true/false tokens)',
    '  "errorConditions": string[],                  // concrete error conditions (predicates) that throw/return error',
    '  "unknowns": string[]                          // reasons for unknown fields (be explicit; use when not derivable)',
    '}',
    '',
    'Rules:',
    '- Extraction over summarization: list concrete facts over prose.',
    '- Avoid ambiguous language (maybe, possibly, around, roughly, typically).',
    '- Use canonical units and normalized forms where possible (e.g., seconds -> ms).',
    '- If unknown or not derivable from code, set null/[] and add a reason to "unknowns" (do not speculate).',
    '- Keep terms concise and domain-relevant (avoid synonyms proliferation).',
    '- Prefer canonical phrasing over stylistic variation.',
    '',
    'Requirements (must-follow):',
    '- Always include ALL keys: primaryPurpose, inputs, outputs, sideEffects, keyBehaviors, invariants, defaults, normalization, limits, constants, errorConditions, unknowns.',
    '- For defaults/normalization/limits/constants/errorConditions: fill with concrete values found in code; if none, use {} or [] as appropriate and add a reason to unknowns (e.g., "no numeric default for timeout found").',
    '- Do NOT leave placeholder words like "string" or type annotations in the output — use only concrete values.',
    '- Do NOT rename or omit any keys. Keep exact casing.',
    '',
    'Checklist before returning:',
    '- Keys present? Values concrete? Units normalized? Unknowns include reasons for any missing concrete facts?'
  ];

  if (gamified) {
    lines.push(
      '',
      'Scoring policy (optimize for maximum total score):',
      '- +1 point: Each claim that is directly supported by the code (you could point to a specific line or expression).',
      '-  0 points: Items that are not derivable from the code. Do NOT guess; instead, set null/[] and add a concrete reason in "unknowns" (e.g., "no default literal for timeout found").',
      '- -1 point: Any unsupported or contradicted claim (e.g., states a default/limit that does not exist or conflicts with code). Strictly avoid these.',
      'Your objective is to maximize the total score. Prefer unknowns with explicit reasons over risky guesses.'
    );
  }

  if (includeSchema) {
    lines.push(
      '',
      'JSON Schema (abbreviated; your output MUST conform):',
      '```json',
      '{',
      '  "type": "object",',
      '  "additionalProperties": false,',
      '  "required": ["primaryPurpose","inputs","outputs","sideEffects","keyBehaviors","invariants","defaults","normalization","limits","constants","errorConditions","unknowns"],',
      '  "properties": {',
      '    "primaryPurpose": { "type": "string" },',
      '    "inputs": { "type": "array", "items": { "type": "string" } },',
      '    "outputs": { "type": "array", "items": { "type": "string" } },',
      '    "sideEffects": { "type": "array", "items": { "type": "string" } },',
      '    "keyBehaviors": { "type": "array", "items": { "type": "string" } },',
      '    "invariants": { "type": "array", "items": { "type": "string" } },',
      '    "defaults": { "type": "object" },',
      '    "normalization": { "type": "array" },',
      '    "limits": { "type": "array" },',
      '    "constants": { "type": "array", "items": { "type": "string" } },',
      '    "errorConditions": { "type": "array", "items": { "type": "string" } },',
      '    "unknowns": { "type": "array", "items": { "type": "string" } }',
      '  }',
      '}',
      '```',
      '',
      'Example Output:',
      '```json',
      '{',
      '  "primaryPurpose": "Manage connections with optional retries and timeouts",',
      '  "inputs": ["endpoint"],',
      '  "outputs": ["none"],',
      '  "sideEffects": ["time delays"],',
      '  "keyBehaviors": ["attempt connection","apply retry policy","respect timeout"],',
      '  "invariants": ["throws on failure"],',
      '  "defaults": { "timeoutMs": 5000, "retryLimit": 3, "secure": true },',
      '  "normalization": [{ "from": "2s", "to": "2000ms" }],',
      '  "limits": [{ "name": "delay", "min": 5, "unit": "ms" }, { "name": "waitStep", "max": 30000, "unit": "ms" }],',
      '  "constants": ["on","off"],',
      '  "errorConditions": ["all attempts fail"],',
      '  "unknowns": []',
      '}',
      '```'
    );
  }

  return lines.join('\n');
}
