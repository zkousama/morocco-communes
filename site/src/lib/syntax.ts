/**
 * Code coloured at build time, by Shiki, into spans whose colours are CSS variables. The
 * variables map to the page's own text colours in Code.astro, so a block follows the
 * theme and every colour is one already checked for contrast.
 */
import { createCssVariablesTheme, createHighlighter } from "shiki";
import { escapeHtml } from "./highlight";

export type Lang = "shell" | "js" | "jsx" | "html" | "json";

const theme = createCssVariablesTheme({ name: "page", variablePrefix: "--code-", fontStyle: true });
const highlighter = await createHighlighter({ themes: [theme], langs: ["shell", "js", "jsx", "html", "json"] });

export function highlight(code: string, lang: Lang): string {
  const { tokens } = highlighter.codeToTokens(code, { lang, theme: "page" });
  return tokens
    .map((line) =>
      line
        .map((token) => {
          const italic = (token.fontStyle ?? 0) & 1 ? ";font-style:italic" : "";
          return `<span style="color:${token.color}${italic}">${escapeHtml(token.content)}</span>`;
        })
        .join(""),
    )
    .join("\n");
}
