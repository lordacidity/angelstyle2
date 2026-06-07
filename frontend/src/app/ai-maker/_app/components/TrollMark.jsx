// The little troll, frozen mid-stand, reused as the brand/logo mark.
// Same single-green pixel art as the favicon and the live PixelTroll sprite,
// so the tab icon, home-screen icon, and header logo are all the same guy.

const SPRITE = [
  '.#..#..#..#.', '..########..', '.##########.', '.##########.', '.##.####.##.',
  '.##########.', '..########..', '#..######..#', '.##########.', '..########..',
  '...######...', '...#....#...', '...#....#...', '..##....##..',
];

export default function TrollMark({ size = 20, color = '#00e676' }) {
  const rects = [];
  SPRITE.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#') rects.push(<rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" />);
    }
  });
  return (
    <svg
      width={size}
      height={(size * 14) / 12}
      viewBox="0 0 12 14"
      fill={color}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {rects}
    </svg>
  );
}
