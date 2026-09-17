import sharp from 'sharp';
const [,, src, ...pts] = process.argv;
const { data, info } = await sharp(src).raw().toBuffer({ resolveWithObject: true });
for (const pt of pts) {
  const [x, y, label] = pt.split(',');
  const i = (+y * info.width + +x) * info.channels;
  const hex = '#' + [0,1,2].map(k => data[i+k].toString(16).padStart(2,'0')).join('');
  console.log((label||'') .padEnd(16), `(${x},${y})`, hex);
}
