import ts from 'typescript';

export interface ReferenceMR {
  defaults: Record<string, number | string | boolean | null>;
  normalization: Array<{ from: string; to: string }>;
  limits: Array<{ name: string; min?: number | string; max?: number | string; unit?: string }>;
  constants: string[];
  errorConditions: string[];
}

function createSource(code: string): ts.SourceFile {
  return ts.createSourceFile('tmp.ts', code, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
}

function isThisProp(node: ts.Expression): { prop?: string } {
  if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return { prop: node.name.text };
  }
  return {};
}

function collectStringLiterals(node: ts.Node, out: Set<string>) {
  function visit(n: ts.Node) {
    if (ts.isStringLiteralLike(n)) {
      out.add(n.text);
    }
    n.forEachChild(visit);
  }
  visit(node);
}

function asNumberLiteral(expr: ts.Expression): number | undefined {
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  return undefined;
}

function asBooleanLiteral(expr: ts.Expression): boolean | undefined {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function flattenMathCalls(expr: ts.Expression, facts: { mins: Array<{ name: string; value: number }>; maxs: Array<{ name: string; value: number }> }) {
  // Recognize Math.min(name, N) / Math.max(N, name) patterns; allow nested
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.expression) && expr.expression.expression.text === 'Math') {
    const method = expr.expression.name.text;
    const args = expr.arguments;
    if (args.length === 2) {
      const a = args[0];
      const b = args[1];
      const numA = asNumberLiteral(a);
      const numB = asNumberLiteral(b);
      const nameA = findIdentifierName(a);
      const nameB = findIdentifierName(b);
      if (method === 'min') {
        // name <= N -> max = N
        if (numB != null && nameA) facts.maxs.push({ name: nameA, value: numB });
        if (numA != null && nameB) facts.maxs.push({ name: nameB, value: numA });
      } else if (method === 'max') {
        // name >= N -> min = N
        if (numB != null && nameA) facts.mins.push({ name: nameA, value: numB });
        if (numA != null && nameB) facts.mins.push({ name: nameB, value: numA });
      }
      // Recurse into nested calls
      flattenMathCalls(a, facts);
      flattenMathCalls(b, facts);
      return;
    }
  }
  // Recurse generically
  expr.forEachChild((c) => flattenMathCalls(c as ts.Expression, facts));
}

function findIdentifierName(expr: ts.Expression): string | undefined {
  // Try to find a representative identifier/property name inside expression
  let found: string | undefined;
  function visit(n: ts.Node) {
    if (found) return;
    // Prefer identifiers/property access that are not Math.*
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const obj = n.expression.expression;
      if (ts.isIdentifier(obj) && obj.text === 'Math') {
        // Dive into arguments to find the real subject
        for (const arg of n.arguments) {
          const candidate = findIdentifierName(arg);
          if (candidate) { found = candidate; return; }
        }
      }
    }
    if (ts.isPropertyAccessExpression(n)) {
      const text = n.getText();
      if (!/^Math\./.test(text)) { found = text; return; }
    }
    if (ts.isIdentifier(n)) {
      if (n.text !== 'Math') { found = n.text; return; }
    }
    n.forEachChild(visit);
  }
  visit(expr);
  return found;
}

export function extractReferenceMRFromCode(code: string): ReferenceMR {
  const sf = createSource(code);
  const defaults: Record<string, number | string | boolean | null> = {};
  const normalization: Array<{ from: string; to: string }> = [];
  const limits: Array<{ name: string; min?: number | string; max?: number | string; unit?: string }> = [];
  const constantsSet: Set<string> = new Set();
  const errorConditions: string[] = [];

  // Track string literals to detect 'on'/'off'
  const stringLits = new Set<string>();
  collectStringLiterals(sf, stringLits);
  if (stringLits.has('on')) constantsSet.add('on');
  if (stringLits.has('off')) constantsSet.add('off');
  if (stringLits.has('UTC')) constantsSet.add('UTC');

  function visit(node: ts.Node) {
    // Assignments: this.x = <expr>
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const { prop } = isThisProp(node.left);
      if (prop) {
        const rhs = node.right;
        const num = asNumberLiteral(rhs);
        const bool = asBooleanLiteral(rhs);
        if (num != null) defaults[prop] = num;
        else if (bool != null) defaults[prop] = bool;
        else if (ts.isBinaryExpression(rhs) && rhs.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
          // this.x = expr ?? <lit>
          const litNum = asNumberLiteral(rhs.right);
          const litBool = asBooleanLiteral(rhs.right);
          if (litNum != null) defaults[prop] = litNum;
          else if (litBool != null) defaults[prop] = litBool;
        }
      }
    }

    // Math.min/max patterns
  if (ts.isCallExpression(node)) {
      const facts = { mins: [] as Array<{ name: string; value: number }>, maxs: [] as Array<{ name: string; value: number }> };
      flattenMathCalls(node, facts);
      // Deduplicate by name+value
      const seenMin = new Set<string>();
      const seenMax = new Set<string>();
      for (const m of facts.mins) {
        const key = `${m.name}|${m.value}`;
        if (!seenMin.has(key)) { seenMin.add(key); limits.push({ name: m.name, min: m.value, unit: 'ms' }); }
      }
      for (const m of facts.maxs) {
        const key = `${m.name}|${m.value}`;
        if (!seenMax.has(key)) { seenMax.add(key); limits.push({ name: m.name, max: m.value, unit: 'ms' }); }
      }
    }

    // Normalization heuristics: regex (\d+)(ms|s) and *1000
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) {
      const a = node.left, b = node.right;
      if (asNumberLiteral(a) === 1000 || asNumberLiteral(b) === 1000) {
        normalization.push({ from: 's', to: 'ms' });
      }
    }

    node.forEachChild(visit);
  }
  visit(sf);

  // Regex literal for (\d+)(ms|s)
  if (/\(\\d\+\)\(ms\|s\)/.test(code) || /(\d+)\s*\*\s*1000/.test(code)) {
    if (!normalization.some((n) => n.from === 's' && /ms/.test(n.to))) normalization.push({ from: 's', to: 'ms' });
  }

  return {
    defaults,
    normalization,
    limits,
    constants: Array.from(constantsSet),
    errorConditions,
  };
}
