import { describe, expect, it } from 'vitest';
import { BEGIN, END, blockData, renderBlock } from './stack.mjs';

const pkg = {
  engines: { node: '>=24' },
  dependencies: { '@angular/core': '22.1.6', zod: '4.6.4' },
  devDependencies: { typescript: '6.0.3', vitest: '4.1.11' },
};

describe('renderBlock', () => {
  it('wraps a table of the manifest entries it knows in the AUTOGEN markers', () => {
    const block = renderBlock(pkg);
    expect(block.startsWith(BEGIN)).toBe(true);
    expect(block.endsWith(END)).toBe(true);
    expect(block).toContain('| node (engines) | `>=24` |');
    expect(block).toContain('| @angular/core | `22.1.6` |');
    expect(block).toContain('| typescript | `6.0.3` |');
    expect(block).toContain('| zod | `4.6.4` |');
  });

  it('skips a row whose package the manifest does not declare', () => {
    expect(renderBlock(pkg)).not.toContain('@playwright/test');
  });
});

describe('blockData', () => {
  it('compares data, not layout: a hand-realigned column is not a change', () => {
    const block = renderBlock(pkg);
    const realigned = block.replace('| node (engines) | `>=24` |', '| node (engines)      |    `>=24`    |');
    expect(blockData(realigned)).toBe(blockData(block));
    expect(blockData(block)).toContain('node (engines)=`>=24`');
  });

  it('is empty when the markers are missing', () => {
    expect(blockData('# no block here')).toBe('');
  });
});
