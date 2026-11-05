/** Caption lines without truncation; a single long word is broken to fit. */
export function imageCaptionLines(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let remaining = word;
    while (remaining) {
      const prefix = line ? `${line} ` : '';
      if (measure(prefix + remaining) <= width) { line = prefix + remaining; break; }
      if (line) { lines.push(line); line = ''; continue; }
      let n = 1;
      while (n < remaining.length && measure(remaining.slice(0, n + 1)) <= width) n++;
      lines.push(remaining.slice(0, n)); remaining = remaining.slice(n);
    }
  }
  if (line) lines.push(line);
  return lines;
}
