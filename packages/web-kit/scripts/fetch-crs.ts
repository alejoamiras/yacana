// Materialises the pinned CRS into <public>/crs: the byte ranges the pinned bb.js requests (2^19 BN254
// points compressed, the G2 point, 2^16 Grumpkin points), each verified against crs.lock.json
// before it is written. A mismatch is a hard failure: a page must never serve an unpinned CRS.
//   bun packages/web-kit/scripts/fetch-crs.ts <public dir>
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import lock from '../crs.lock.json';

const sha256 = (bytes: Uint8Array) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

async function download(name: string, bytes: number): Promise<Uint8Array> {
  let lastError: unknown;
  for (const host of lock.hosts) {
    try {
      const res = await fetch(`${host}/${name}`, { headers: { Range: `bytes=0-${bytes - 1}` } });
      if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`could not download ${name}: ${String(lastError)}`);
}

export async function fetchCrs(publicDir: string): Promise<void> {
  const out = resolve(publicDir, 'crs');
  mkdirSync(out, { recursive: true });
  for (const [name, pin] of Object.entries(lock.files)) {
    const file = Bun.file(resolve(out, name));
    if (await file.exists()) {
      const cached = new Uint8Array(await file.arrayBuffer());
      if (cached.length === pin.bytes && sha256(cached) === pin.sha256) continue;
    }
    const data = await download(name, pin.bytes);
    const digest = sha256(data);
    if (data.length !== pin.bytes || digest !== pin.sha256)
      throw new Error(
        `${name}: got ${data.length} bytes, sha256 ${digest}; pinned ${pin.bytes} / ${pin.sha256}`,
      );
    await Bun.write(file, data);
    console.log(`crs: ${name} ${pin.bytes} bytes ok`);
  }
}

if (import.meta.main) {
  const publicDir = process.argv[2];
  if (!publicDir) throw new Error('usage: fetch-crs.ts <public dir>');
  await fetchCrs(resolve(publicDir));
}
