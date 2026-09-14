import { describe, expect, it } from 'vitest';
import {
  insideTemplateLiteral,
  parseExports,
  parseImports,
  parseSubscriptions,
  parseTypeImports,
  returnType,
  stripBlockComments,
} from './index-code.mjs';

describe('stripBlockComments', () => {
  it('blanks block comments and whole-line comments while keeping line numbers', () => {
    const source =
      "// header mentions tools/testing/**) on purpose\nimport { a } from './a.mjs';\n/* gone */ const b = 1;\n";
    const stripped = stripBlockComments(source);
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length);
    expect(stripped).toContain("import { a } from './a.mjs';");
    expect(stripped).toContain('const b = 1;');
    expect(stripped).not.toContain('gone');
    expect(stripped).not.toContain('header');
  });
});

describe('insideTemplateLiteral', () => {
  it('is true between unescaped backticks and false after them', () => {
    const code = 'const t = `a ${b} c`; const d = 1;';
    expect(insideTemplateLiteral(code, code.indexOf('${b}'))).toBe(true);
    expect(insideTemplateLiteral(code, code.indexOf('const d'))).toBe(false);
  });

  it('ignores escaped backticks', () => {
    const code = 'const t = `run \\`x\\` now`; const d = 1;';
    expect(insideTemplateLiteral(code, code.indexOf('const d'))).toBe(false);
  });
});

describe('parseExports', () => {
  it('finds declarations and export lists but not re-exports', () => {
    const source = [
      'export function a() {}',
      'export const b = 1;',
      'export abstract class C {}',
      'export async function d() {}',
      'export { e };',
      "export { g } from './x.js';",
    ].join('\n');
    const names = parseExports(source);
    expect(names).toEqual(expect.arrayContaining(['a', 'b', 'C', 'd', 'e']));
    expect(names).not.toContain('g');
  });
});

describe('parseImports', () => {
  it('resolves local static and dynamic imports, drops packages and generated code', () => {
    const source = [
      "import { a } from './b.mjs';",
      "import fs from 'node:fs';",
      "const lazy = () => import('./d.mjs');",
      "const generated = `import { y } from './c.mjs';`;",
    ].join('\n');
    expect(parseImports(source, 'tools/scripts/a.mjs')).toEqual(['tools/scripts/b.mjs', 'tools/scripts/d.mjs']);
  });

  it('maps NodeNext `.js` specifiers of TypeScript sources to the `.ts` file on disk', () => {
    expect(parseImports("import { a } from './b.js';", 'tools/alm/x.ts')).toEqual(['tools/alm/b.ts']);
  });
});

describe('parseSubscriptions', () => {
  it('reports receiver:event pairs from code, not from comments or template literals', () => {
    const source = [
      "emitter.on('data', f);",
      "process.once('exit', g);",
      "/* page.on('console') is documented here */",
      "const generated = `page.on('load', h);`;",
    ].join('\n');
    expect(parseSubscriptions(source)).toEqual(['emitter:data', 'process:exit']);
  });
});

describe('parseTypeImports', () => {
  it('takes type imports from annotations, not from backticked examples in the prose', () => {
    const source =
      "/**\n * See `import('./example.js')` in the docs.\n * @type {import('./types.js').Foo}\n */\nexport const x = 1;";
    expect(parseTypeImports(source, 'tools/a.mjs')).toEqual(['tools/types.js']);
  });
});

describe('returnType', () => {
  it('keeps balanced braces of an object type', () => {
    expect(returnType('/**\n * @returns {{ ok: boolean, code: number }} what happened\n */')).toBe(
      '{ ok: boolean, code: number }',
    );
  });

  it('is empty without a @returns tag', () => {
    expect(returnType('/** @param {string} a */')).toBe('');
  });
});
