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
    'Answer this question about the following code:',
    '',
    '## Target Code',
    '',
    `${elementType}: ${name}`,
    '',
    '```typescript',
    code,
    '```',
    '',
    '## Question',
    '',
    question,
    '',
    'Respond with 2-3 sentences describing what you understand.'
  ].join('\n');
}
