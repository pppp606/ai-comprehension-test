interface TestGenerationTemplateOptions {
  className: string;
  methodName: string;
  implementation: string;
}

export function buildTestGenerationPrompt(options: TestGenerationTemplateOptions): string {
  const { className, methodName, implementation } = options;
  return [
    'You are generating a Jest test file for a TypeScript project.',
    '',
    'Target:',
    `- Class: ${className}`,
    `- Method: ${methodName}`,
    '',
    'General Requirements:',
    '- Return ONLY raw TypeScript code (no markdown).',
    '- Use Jest and ts-jest conventions.',
    '- Prefer AAA (Arrange, Act, Assert) structure.',
    '- Include normal, edge, and error test cases.',
    '',
    'Import and path details will be provided later in the prompt.',
    '',
    'Reference Implementation (do not inline; for understanding only):',
    '```typescript',
    implementation,
    '```',
  ].join('\n');
}
