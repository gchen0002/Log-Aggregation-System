const paths = {
  search: 'm21 21-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  grid: 'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10 M10 22h4',
  box: 'm3 7 9-5 9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10 M7 4l10 6',
  file: 'M5 2h9l5 5v15H5z M14 2v6h5',
  database:
    'M21 5c0 2-4 4-9 4S3 7 3 5s4-4 9-4 9 2 9 4 M3 5v14c0 2 4 4 9 4s9-2 9-4V5 M3 12c0 2 4 4 9 4s9-2 9-4',
  close: 'm5 5 14 14 M19 5 5 19',
  chevron: 'm9 5 7 7-7 7',
  check: 'm4 12 5 5L20 6',
  pause: 'M8 4v16 M16 4v16',
  play: 'm6 3 15 9-15 9z',
  monitor: 'M2 3h20v14H2z M8 22h8 M12 17v5',
  copy: 'M8 8h13v13H8z M4 16H2V2h14v2',
  arrow: 'M3 12h17 M14 6l6 6-6 6',
  queue: 'M8 5h14 M8 12h14 M8 19h14 M2 5h1 M2 12h1 M2 19h1',
  bolt: 'm13 1-9 13h7l-1 9 10-14h-8z',
};
export type IconName = keyof typeof paths;
export default function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
