import { describe, expect, test } from "bun:test"
import { stripAttachmentTags } from "../../src/util/attachment_tag"

describe("stripAttachmentTags", () => {
  test("removes self-closing tag", () => {
    const s = 'Hello\n<render_attachment id="a" version="1"/>\nWorld'
    expect(stripAttachmentTags(s)).toBe("Hello\n\nWorld")
  })

  test("removes tag with space before close", () => {
    expect(stripAttachmentTags('<render_attachment id="a" version="1" />')).toBe("")
  })

  test("leaves other XML alone", () => {
    expect(stripAttachmentTags("<div>ok</div>")).toBe("<div>ok</div>")
  })
})
