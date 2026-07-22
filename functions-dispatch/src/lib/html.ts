// Escape untrusted text before interpolating into HTML email bodies. Alert
// summaries are staff free text - unescaped, they could inject markup into the
// email, the same stored-XSS class fixed on the rider web page.
export function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
