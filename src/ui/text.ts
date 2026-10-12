// Text cut and wrapped to a number of cells: what the graph's layout, its
// paint, the detail pane and the help pages share. Pure TypeScript: no `$`,
// no engine imports.

/** `text` in at most `max` cells: cut, it ends in `…`. */
export function clip(text: string, max: number): string {
  if (max <= 0) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** `text` as lines no wider than `width`, broken between words; a word longer than a line is cut. */
export function wrapText(text: string, width: number): string[] {
  const room = Math.max(1, Math.trunc(width))
  const out: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (let word of paragraph.split(/\s+/).filter(one => one !== '')) {
      if (line !== '' && line.length + 1 + word.length <= room) {
        line += ` ${word}`
        continue
      }
      if (line !== '') out.push(line)
      while (word.length > room) {
        out.push(word.slice(0, room))
        word = word.slice(room)
      }
      line = word
    }
    if (line !== '') out.push(line)
  }
  return out
}

/** At most `max` lines of `text`: the last one ends in `…` when there is more. */
export function firstLines(text: string, width: number, max: number): string[] {
  const all = wrapText(text, width)
  if (all.length <= max) return all
  const shown = all.slice(0, max)
  const last = shown[max - 1] ?? ''
  if (max > 0) shown[max - 1] = last.length + 1 > width ? `${last.slice(0, Math.max(0, width - 1))}…` : `${last}…`
  return shown
}

export function moreLines(count: number): string {
  return `… ${count} more ${count === 1 ? 'line' : 'lines'}`
}

/** All of `text` wrapped, or its first `max - 1` lines and a row saying how many more there are. */
export function cappedLines(text: string, width: number, max: number): { lines: string[]; more: number } {
  const all = wrapText(text, width)
  const most = Math.max(1, Math.trunc(max))
  if (all.length <= most) return { lines: all, more: 0 }
  const lines = all.slice(0, Math.max(1, most - 1))
  return { lines, more: all.length - lines.length }
}
