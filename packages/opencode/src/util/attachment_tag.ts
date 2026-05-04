/** Kibana Agent Builder may emit `<render_attachment …/>` in assistant markdown; it only renders in web UI. */
const TAG = /<render_attachment\b[^>]*>/gi

export function stripAttachmentTags(s: string): string {
  const t = s.replace(TAG, "")
  return t.replace(/[ \t]+\n/g, "\n").trim()
}
