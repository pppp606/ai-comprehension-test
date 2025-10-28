interface StabilityPromptOptions {
  elementType: 'Class' | 'Method';
  name: string;
  code: string;
  question: string;
}

export function buildStabilityPrompt(options: StabilityPromptOptions): string {
  const { elementType, name, code, question } = options;
  return [
    'You have access to the entire project codebase as context.',
    '',
    'Read the code and answer the question by returning ONLY a normalized JSON “meaning representation” (MR) that captures understanding independent of wording.',
    'Strict requirements: Output must be valid JSON (double quotes, no comments, no trailing commas), a single object, and no markdown or extra text.',
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
    '  "invariants": string[]                       // assumptions or guarantees maintained',
    '}',
    '',
    'Rules:',
    '- Keep terms concise and domain-relevant (avoid synonyms proliferation).',
    '- Prefer canonical phrasing over stylistic variation.',
    '- If unknown, use [] or "none" rather than speculating.'
  ].join('\n');
}
