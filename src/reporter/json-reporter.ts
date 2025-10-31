import fs from 'fs/promises';
import path from 'path';
import { TestResults } from '../types';

export async function writeJsonReport(report: TestResults, outputDir: string, fileName: string = 'results.json'): Promise<string> {
  const filePath = path.join(outputDir, fileName);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}
