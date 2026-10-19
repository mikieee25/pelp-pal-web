export function parseNetworkUrl(output) {
  return output.match(/(?:^|\n)\s*-\s*Network:\s*(https?:\/\/[^\s\u001b]+)/)?.[1] ?? null;
}
