interface StabilityJudgmentTemplateOptions {
  originalQuestion: string;
  code: string;
  responses: string[];
}

export function buildStabilityJudgmentPrompt(options: StabilityJudgmentTemplateOptions): string {
  const { originalQuestion, code, responses } = options;
  const labelled = responses
    .map((response, index) => `Response ${index + 1}: ${response}`)
    .join(' ');

  return [
    'You have access to the entire project codebase as context.',
    '',
    'Evaluate the consistency of these 5 responses to the same question.',
    '',
    '## Original Question',
    '',
    `"${originalQuestion}"`,
    '',
    '## Target Code',
    '',
    '```typescript',
    code,
    '```',
    '',
    '## 5 Responses',
    '',
    labelled,
    '',
    '## Task',
    '',
    'Analyze the consistency of these responses and respond ONLY with JSON (no markdown, no extra text): { "consistencyScore": number, "consistencyLevel": "HIGH" | "MEDIUM" | "LOW", "mainIdea": "string", "variations": [ { "aspect": "string", "values": ["string"], "frequency": number } ], "reasoning": "string", "codeClarity": "CLEAR" | "AMBIGUOUS" | "MISLEADING" }'
  ].join('\n');
}
