// "Ana" of "Ana Ruiz": the first word of a person's name, or the name as it
// is when it has none.
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
