import { escapeHtml } from "./highlight";

/** Plain text with `code` spans, as HTML. The only markup the docs copy uses. */
export const inline = (text: string) =>
  escapeHtml(text).replace(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`);
