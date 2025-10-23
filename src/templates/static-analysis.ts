interface StaticAnalysisTemplateOptions {
  elementType: 'Class' | 'Method';
  name: string;
  code: string;
}

export function buildStaticAnalysisPrompt(options: StaticAnalysisTemplateOptions): string {
  const { elementType, name, code } = options;
  return [
    'You have access to the entire project codebase as context.',
    '',
    'Analyze this code element for naming accuracy:',
    '',
    '## Target Code',
    '',
    `${elementType}: ${name}`,
    '',
    '```typescript',
    code,
    '```',
    '',
    '## Task',
    '',
    'Evaluate whether the name accurately reflects the implementation. Consider the entire codebase context when making your assessment.',
    '',
    'Respond ONLY with JSON in this exact format (no markdown, no extra text): { "nameAccuracy": boolean, "nameAccuracyScore": number, "issues": ["string"], "suggestions": ["string"], "clarity": "HIGH" | "MEDIUM" | "LOW", "reasoning": "string" }'
  ].join('\n');
}
