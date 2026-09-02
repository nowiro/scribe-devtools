// prettier.config.mjs — ONE formatting configuration for the whole repository.
//
// There used to be two: `.prettierrc` at the root at 100 columns and
// `integrations/prettier.config.mjs` at 120. The stated reason was to keep the domain
// byte-compatible with the repository it had been ported from, so that a re-port would not open
// with a several-thousand-line formatting diff. That repository is gone, the port will not
// happen again, and what was left was two files that could disagree — with `npm run format:check`
// judging each half by a different rule.
//
// 120 is the surviving number, because moving 12 kLOC of domain code to 100 would be a large
// diff that buys nothing. `.mjs` rather than `.prettierrc`, because only this form takes a
// comment, and a formatting rule without its reason is how the previous split survived so long.
export default {
  endOfLine: 'lf',
  printWidth: 120,
  singleQuote: true,
  trailingComma: 'all',
  proseWrap: 'preserve',
  overrides: [
    {
      files: ['*.json', '*.yaml', '*.yml'],
      options: { singleQuote: false },
    },
  ],
};
