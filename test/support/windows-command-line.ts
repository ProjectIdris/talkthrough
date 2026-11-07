/** libuv's default Windows argv quoting (no shell, windowsVerbatimArguments false).
 * Backslashes only double before a quote or at the end of a quoted argument. */
export function quoteWindowsArgument(argument: string): string {
  if (argument.length && !/[ \t"]/u.test(argument)) return argument;
  let quoted = '"', slashes = 0;
  for (const character of argument) {
    if (character === '\\') { slashes++; continue; }
    quoted += '\\'.repeat(character === '"' ? slashes * 2 + 1 : slashes) + character;
    slashes = 0;
  }
  return quoted + '\\'.repeat(slashes * 2) + '"';
}

/** Windows CreateProcess counts UTF-16 code units, including the terminating NUL. */
export function windowsCommandLineLength(executable: string, args: readonly string[]): number {
  return [executable, ...args].map(quoteWindowsArgument).join(' ').length + 1;
}
