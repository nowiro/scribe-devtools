// prettier.config.mjs — Markdown ONLY. Everything else in this repository is formatted by Biome.
//
// Two formatters is not an accident and not a leftover: Biome has no Markdown formatter at all.
// Its 2.x configuration schema knows css, graphql, grit, html, javascript and json, and the word
// "markdown" does not appear in it — measured against the installed package, not assumed. A Biome
// plugin cannot close that gap either: plugins are GritQL patterns matched against a tree Biome
// itself parsed, and a `.md` file never enters the pipeline (`biome check x.md` answers "these
// paths were provided but ignored", plugin configured or not). So the choice was prose formatted
// by a second tool, or prose formatted by nobody.
//
// The numbers are the ones this repository used before the move to Biome, so the Markdown that was
// formatted then is formatted the same way now. `singleQuote` matters more than it looks: it keeps
// the YAML front matter of `.prompt.md` and `.instructions.md` files in single quotes, which is how
// they are written; without it every one of those files churns on the first run.
export default {
  endOfLine: 'lf',
  printWidth: 120,
  singleQuote: true,
  proseWrap: 'preserve',
};
