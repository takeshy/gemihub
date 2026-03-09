/**
 * Fix markdown bullet markers (* ) that appear when copying from
 * ChatGPT/GPT UI (browser converts YAML "- " to "* ").
 */
export function fixMarkdownBullets(text: string): string {
  return text.replace(/^(\s*)\* /gm, "$1- ");
}
