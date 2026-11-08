import { createBaselineParts, PART_ORDER, worldToFiaMm } from '../src/regulations/fia2026';

const parts = createBaselineParts();

for (const id of PART_ORDER) {
  const part = parts[id];
  console.log(`\n=== ${id} (${part.cols}x${part.rows}) ===`);
  for (let u = 0; u < part.cols; u++) {
    const rowStr = part.grid[u]
      .map((pt, v) => {
        const fia = worldToFiaMm(pt);
        return `[${u},${v}]:(${Math.round(fia.xF)},${Math.round(fia.yFia)},${Math.round(fia.zFia)})`;
      })
      .join('  ');
    console.log(`  col u=${u}: ${rowStr}`);
  }
}
