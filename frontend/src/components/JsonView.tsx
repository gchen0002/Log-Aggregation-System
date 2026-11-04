export default function JsonView({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const tokens: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(
    /"(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null|-?\d+(?:\.\d+)?)\b/g,
  )) {
    tokens.push(text.slice(cursor, match.index));
    tokens.push(
      <span
        className={
          match[0].endsWith(':')
            ? 'json-key'
            : match[0].startsWith('"')
              ? 'json-string'
              : 'json-number'
        }
        key={match.index}
      >
        {match[0]}
      </span>,
    );
    cursor = match.index! + match[0].length;
  }
  tokens.push(text.slice(cursor));
  return (
    <pre className="json-view">
      <code>{tokens}</code>
    </pre>
  );
}
