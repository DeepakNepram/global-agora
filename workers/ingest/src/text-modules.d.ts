/** Wrangler bundles `*.txt` imports as strings (the Text module rule in wrangler.jsonc). */
declare module '*.txt' {
  const content: string;
  export default content;
}
