// Copyright (c) 2026-present, Elastic NV
// This file is derived from opencode (https://github.com/anomalyco/opencode)
// and has been modified by Elastic NV. Changes: added wrapMode prop, persistent underline, and pointer cursor on hover
import { onCleanup, type JSX } from "solid-js"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import open from "open"

export interface LinkProps {
  href: string
  children?: JSX.Element | string
  fg?: RGBA
  wrapMode?: "none" | "char" | "word"
}

/**
 * Link component that renders clickable hyperlinks.
 * Always underlined to read as a link; hovering switches the terminal mouse
 * pointer to "pointer" (where the terminal supports it). Clicking opens the
 * URL in the default browser.
 */
export function Link(props: LinkProps) {
  const displayText = props.children ?? props.href
  const renderer = useRenderer()

  onCleanup(() => renderer?.setMousePointer("default"))

  return (
    <text
      fg={props.fg}
      wrapMode={props.wrapMode}
      attributes={TextAttributes.UNDERLINE}
      onMouseOver={() => renderer?.setMousePointer("pointer")}
      onMouseOut={() => renderer?.setMousePointer("default")}
      onMouseUp={() => {
        open(props.href).catch(() => {})
      }}
    >
      {displayText}
    </text>
  )
}
