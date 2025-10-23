#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { runCommand } from './run';

dotenv.config();

const program = new Command();

program
  .name('ai-comprehension-test')
  .description('CLI to evaluate how well AI agents comprehend a codebase')
  .version('0.1.0');

program
  .command('run')
  .description('Scan the project and execute AI comprehension tests')
  .argument('[projectPath]', 'Path to the project root', '.')
  .option('--files <files>', 'Comma separated list of files to focus on')
  .option('--output <dir>', 'Output directory', '.ai-comp-test')
  .option('--format <format>', 'Report format: console | json', 'console')
  .option('--verbose', 'Enable verbose logging', false)
  .action(async (projectPath: string, options: any) => {
    try {
      await runCommand(projectPath, {
        files: options.files ? options.files.split(',').map((file: string) => file.trim()).filter(Boolean) : undefined,
        output: options.output,
        format: options.format,
        verbose: options.verbose,
      });
    } catch (error: any) {
      console.error(error?.message || error);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
