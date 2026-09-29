import { Engine } from '../src/sim/engine';
const e = new Engine();
const st = e.state;
for (const [sku, whs] of Object.entries(st.inv)) {
  for (const [wh, counts] of Object.entries(whs as Record<string, any>)) {
    const locSum = Object.values(st.locations)
      .filter((l: any) => l.warehouseId === wh && l.kind === 'STORAGE')
      .reduce((s: number, l: any) => s + ((l.contents as any)[sku] ?? 0), 0);
    if (locSum !== (counts.AVAILABLE ?? 0)) {
      console.log(`MISMATCH ${sku} ${wh}: loc=${locSum} AVAILABLE=${counts.AVAILABLE} total=${Object.values(counts).reduce((a: number, b: number) => a + b, 0)}`);
    }
  }
}
// zone coverage per wh
for (const w of st.warehouses) {
  const bins = Object.values(st.locations).filter((l: any) => l.warehouseId === w.id && l.kind === 'STORAGE');
  const zones = [...new Set(bins.map((b: any) => b.zone))];
  const skusIn = new Set(bins.flatMap((b: any) => Object.keys(b.contents)));
  console.log(`${w.id}: bins=${bins.length} zones=${zones.join(',')} skus_stored=${skusIn.size}`);
}
