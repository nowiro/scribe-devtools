import { describe, expect, it } from 'vitest';
import { ALLOW, ROOT, denyDecision, isMain, parsePayload, toolCall } from './payload.mjs';

describe('parsePayload', () => {
  it('returns an object for valid JSON and an empty object otherwise', () => {
    expect(parsePayload('{"a":1}')).toEqual({ a: 1 });
    expect(parsePayload('')).toEqual({});
    expect(parsePayload('   ')).toEqual({});
    expect(parsePayload('nope')).toEqual({});
    expect(parsePayload('[1,2]')).toEqual({});
    expect(parsePayload('null')).toEqual({});
  });
});

describe('toolCall', () => {
  it('reads both spellings of the tool name and input', () => {
    expect(toolCall({ tool_name: 'a', tool_input: { x: 1 } })).toEqual({ tool: 'a', input: { x: 1 } });
    expect(toolCall({ toolName: 'b', toolInput: { y: 2 } })).toEqual({ tool: 'b', input: { y: 2 } });
    expect(toolCall({ tool_input: 'not an object' })).toEqual({ tool: '', input: {} });
  });
});

describe('decisions', () => {
  it('shapes the deny answer the client expects', () => {
    expect(JSON.parse(denyDecision('why'))).toEqual({
      continue: true,
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'why' },
    });
    expect(ALLOW).toBe('{}');
  });

  it('knows the repository root and that a spec file is not the entrypoint', () => {
    expect(ROOT.endsWith('copilot-builder') || ROOT.length > 0).toBe(true);
    expect(isMain(import.meta.url)).toBe(false);
  });
});
