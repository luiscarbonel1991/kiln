// "1 scene", "3 scenes": a count with its noun, singular for one.
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
