import chalk from 'chalk';
import { TestResults } from '../types';

export function printConsoleReport(report: TestResults): void {
  const { summary, byTestType, results, criticalIssues } = report;

  console.log(chalk.bold('📊 AI Comprehension Test Results'));
  console.log(chalk.bold('====================================='));
  console.log();
  console.log(`${chalk.bold('Project:')} ${summary.projectPath}`);
  console.log(`${chalk.bold('Files:')} ${summary.filesSpecified && summary.filesSpecified.length > 0 ? summary.filesSpecified.join(', ') : 'All files'}`);
  console.log(`${chalk.bold('Executed:')} ${summary.executedAt}`);
  console.log(`${chalk.bold('Total Tests:')} ${summary.totalTests}`);
  console.log();
  console.log(`${chalk.bold('Overall Score:')} ${summary.overallScore}/100`);
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();

  console.log(chalk.bold('Summary by Test Type'));
  console.log();
  console.log(drawTable([
    ['Test Type', 'Total', 'Passed', 'Score'],
    ['Static Analysis', formatInt(byTestType['static-analysis'].total), formatInt(byTestType['static-analysis'].passed), formatPercent(byTestType['static-analysis'].averageScore)],
    ['Stability', formatInt(byTestType['stability'].total), formatInt(byTestType['stability'].passed), formatPercent(byTestType['stability'].averageScore)],
    ['Test Generation', formatInt(byTestType['test-generation'].total), formatInt(byTestType['test-generation'].passed), formatPercent(byTestType['test-generation'].averageScore)],
  ]));
  console.log();
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();

  const staticResults = results.filter((result) => result.type === 'static-analysis');
  if (staticResults.length > 0) {
    console.log(chalk.bold(`Static Analysis Tests (${staticResults.length} tests)`));
    console.log();
    for (const result of staticResults) {
      console.log(`${result.passed ? '✅' : '❌'} ${result.testName}`);
      if (typeof result.score === 'number') {
        console.log(`   Score: ${result.score}/100`);
      }
      if (!result.passed && result.data?.issues) {
        console.log('   Issues:');
        for (const issue of result.data.issues) {
          console.log(`   - ${issue}`);
        }
      }
      if (!result.passed && result.data?.suggestions?.length) {
        console.log('   Suggestions:');
        for (const suggestion of result.data.suggestions) {
          console.log(`   - ${suggestion}`);
        }
      }
      console.log();
    }
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log();
  }

  const stabilityResults = results.filter((result) => result.type === 'stability');
  if (stabilityResults.length > 0) {
    console.log(chalk.bold(`Stability Tests (${stabilityResults.length} tests)`));
    console.log();
    for (const result of stabilityResults) {
      console.log(`${result.passed ? '✅' : '❌'} ${result.testName}`);
      if (typeof result.score === 'number') {
        console.log(`   Consistency: ${result.score}% (${result.data?.consistencyLevel || 'UNKNOWN'})`);
      }
      if (result.data?.coverage) {
        const cov = result.data.coverage;
        const specPart = cov.specificityModel != null
          ? `specificity ${cov.specificity}% (model ${cov.specificityModel}%)`
          : `specificity ${cov.specificity}%`;
        console.log(`   Coverage: schema ${cov.schemaCoverage}% | ${specPart}`);
      }
      if (result.data?.groundedness) {
        const gr = result.data.groundedness;
        console.log(`   Groundedness: ${gr.score ?? 0}%` + (gr.factCoverage != null ? ` (fact coverage ${gr.factCoverage}%)` : ''));
        if (gr.mismatches && gr.mismatches.length > 0) {
          const first = gr.mismatches.slice(0, 2).map((m: any) => m.fact).join('; ');
          console.log(`   Mismatches: ${first}${gr.mismatches.length > 2 ? ' …' : ''}`);
        }
      }
      if (!result.passed && result.data?.codeClarity) {
        console.log(`   Code Clarity: ${result.data.codeClarity}`);
      }
      console.log();
    }
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log();
  }

  const generationResults = results.filter((result) => result.type === 'test-generation');
  if (generationResults.length > 0) {
    console.log(chalk.bold(`Test Generation Tests (${generationResults.length} tests)`));
    console.log();
    for (const result of generationResults) {
      console.log(`${result.passed ? '✅' : '❌'} ${result.testName}`);
      if (!result.passed && result.data?.errorAnalysis?.summary) {
        console.log(`   Error: ${result.data.errorAnalysis.summary}`);
      }
      console.log();
    }
    console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log();
  }

  if (criticalIssues.length > 0) {
    console.log(chalk.bold('Critical Issues (Score < 50)'));
    console.log();
    for (const issue of criticalIssues) {
      console.log(`🔴 ${issue.element}`);
      if (issue.summary) {
        console.log(`   - ${issue.summary}`);
      }
      if (issue.recommendation) {
        console.log(`   💡 Recommendation: ${issue.recommendation}`);
      }
      console.log();
    }
  }

  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();
  console.log(`${chalk.bold('Execution Time:')} ${formatDuration(summary.executionTimeMs)}`);
}

function drawTable(rows: string[][]): string {
  const colWidths = rows[0].map((_, colIndex) => Math.max(...rows.map((row) => row[colIndex].length)));
  return rows
    .map((row, rowIndex) => {
      const line = row
        .map((cell, colIndex) => cell.padEnd(colWidths[colIndex]))
        .join(' │ ');
      if (rowIndex === 0) {
        const separator = colWidths.map((width) => '─'.repeat(width)).join('─┼─');
        return `${line}\n${separator}`;
      }
      return line;
    })
    .join('\n');
}

function formatInt(value: number): string {
  return value.toString();
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
