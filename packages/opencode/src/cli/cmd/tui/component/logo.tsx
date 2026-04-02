import { TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { letters, colors, bowl, bowlColor } from "@/cli/logo"

export function Logo() {
  const rows: JSX.Element[] = []
  for (let row = 0; row < 3; row++) {
    const parts: JSX.Element[] = []
    // Bowl art on the left
    parts.push(
      <text fg={bowlColor} attributes={TextAttributes.BOLD} selectable={false}>
        {bowl[row]}
      </text>,
    )
    parts.push(<text selectable={false}>{"  "}</text>)
    for (let i = 0; i < letters.length; i++) {
      if (i > 0) parts.push(<text selectable={false}>{" "}</text>)
      parts.push(
        <text fg={colors[i]} attributes={TextAttributes.BOLD} selectable={false}>
          {letters[i][row]}
        </text>,
      )
    }
    rows.push(<box flexDirection="row">{parts}</box>)
  }

  return <box>{rows}</box>
}
