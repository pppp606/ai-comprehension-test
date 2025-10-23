import fs from 'fs/promises';
import path from 'path';
import ts from 'typescript';
import { ClassInfo, FunctionInfo, MethodInfo, ParameterInfo, ProjectStructure, PropertyInfo, ScanOptions } from '../types';

const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', '.git', '.ai-comp-test']);

export class TypeScriptScanner {
  async scan(options: ScanOptions): Promise<ProjectStructure> {
    const projectPath = options.projectPath;
    const filesToScan = options.files && options.files.length > 0
      ? options.files.map((file) => path.resolve(projectPath, file))
      : await this.findAllTypeScriptFiles(projectPath);

    const classes: ClassInfo[] = [];
    const functions: FunctionInfo[] = [];

    for (const filePath of filesToScan) {
      const fileClasses: ClassInfo[] = [];
      const fileFunctions: FunctionInfo[] = [];
      await this.parseFile(filePath, fileClasses, fileFunctions);
      classes.push(...fileClasses);
      functions.push(...fileFunctions);
    }

    return {
      classes,
      functions,
      totalFiles: filesToScan.length,
      scannedFiles: filesToScan,
      scannedAt: new Date(),
    };
  }

  private async parseFile(filePath: string, classes: ClassInfo[], functions: FunctionInfo[]): Promise<void> {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, fileContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.getText();
        const classSource = node.getText();
        const methods: MethodInfo[] = [];
        const properties: PropertyInfo[] = [];

        node.members.forEach((member) => {
          if (ts.isMethodDeclaration(member) && member.name) {
            const methodName = member.name.getText();
            const methodSource = member.getText();
            const parameters: ParameterInfo[] = member.parameters.map((param) => ({
              name: param.name.getText(),
              type: param.type ? param.type.getText() : 'any',
              isOptional: !!param.questionToken,
            }));
            const signature = `${methodName}(${parameters.map((p) => `${p.name}${p.isOptional ? '?' : ''}: ${p.type}`).join(', ')})`;
            const returnType = member.type ? member.type.getText() : 'void';
            const isAsync = !!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
            const isStatic = !!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
            const loc = this.calculateLoc(methodSource);

            methods.push({
              name: methodName,
              sourceCode: methodSource,
              signature,
              parameters,
              returnType,
              isAsync,
              isStatic,
              loc,
            });
          } else if (ts.isPropertyDeclaration(member) && member.name) {
            const name = member.name.getText();
            const type = member.type ? member.type.getText() : 'any';
            const isReadonly = !!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
            const isPrivate = !!member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword);
            properties.push({ name, type, isReadonly, isPrivate });
          }
        });

        const loc = this.calculateLoc(classSource);
        const isExported = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

        classes.push({
          name: className,
          file: filePath,
          sourceCode: classSource,
          methods,
          properties,
          loc,
          isExported,
        });
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.getText();
        const functionSource = node.getText();
        const signature = `${functionName}(${node.parameters.map((param) => param.name.getText()).join(', ')})`;
        const loc = this.calculateLoc(functionSource);
        functions.push({
          name: functionName,
          file: filePath,
          sourceCode: functionSource,
          signature,
          loc,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private async findAllTypeScriptFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    const walk = async (currentDir: string) => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
    };

    await walk(dir);
    return files;
  }

  private calculateLoc(source: string): number {
    return source.split('\n').filter((line) => line.trim().length > 0).length;
  }
}
