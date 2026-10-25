// An AztecAsyncKVStore that lives and dies with the page. The embedded wallet writes every
// account's sk, salt and signing key to its WalletDB; on this store they never reach disk.
// Only the map is real (the WalletDB uses maps); the other collections would be a silent bug.
import type { AztecAsyncKVStore, AztecAsyncMap, Key, Range } from '@aztec-labs/kv-store';

// The store's value type is not exported; the WalletDB stores Buffers.
type Value = unknown;

type Entry<K, V> = { key: K; value: V };

// LMDB's ordered-binary orders numbers numerically and strings lexically; keys of mixed kinds
// never share a map here.
const compare = (a: Key, b: Key): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

const id = (k: Key): string => (typeof k === 'number' ? `n:${k}` : `s:${String(k)}`);

class MemoryMap<K extends Key, V extends Value> implements AztecAsyncMap<K, V> {
  private readonly entries = new Map<string, Entry<K, V>>();

  async set(key: K, value: V): Promise<void> {
    this.entries.set(id(key), { key, value });
  }

  async setMany(entries: { key: K; value: V }[]): Promise<void> {
    for (const e of entries) this.entries.set(id(e.key), e);
  }

  async setIfNotExists(key: K, value: V): Promise<boolean> {
    if (this.entries.has(id(key))) return false;
    this.entries.set(id(key), { key, value });
    return true;
  }

  async delete(key: K): Promise<void> {
    this.entries.delete(id(key));
  }

  async getAsync(key: K): Promise<V | undefined> {
    return this.entries.get(id(key))?.value;
  }

  async getManyAsync(keys: K[]): Promise<(V | undefined)[]> {
    return keys.map((k) => this.entries.get(id(k))?.value);
  }

  async hasAsync(key: K): Promise<boolean> {
    return this.entries.has(id(key));
  }

  async sizeAsync(): Promise<number> {
    return this.entries.size;
  }

  /** Forward: [start, end). Reverse: (start, end] descending. Then the limit. As the LMDB store answers. */
  private select(range: Range<K> = {}): Entry<K, V>[] {
    const { start, end, reverse, limit } = range;
    const inside = (k: K) =>
      reverse
        ? (start === undefined || compare(k, start) > 0) && (end === undefined || compare(k, end) <= 0)
        : (start === undefined || compare(k, start) >= 0) && (end === undefined || compare(k, end) < 0);
    let rows = [...this.entries.values()].filter((r) => inside(r.key)).sort((a, b) => compare(a.key, b.key));
    if (reverse) rows.reverse();
    if (limit !== undefined) rows = rows.slice(0, limit);
    return rows;
  }

  async *entriesAsync(range?: Range<K>): AsyncIterableIterator<[K, V]> {
    for (const r of this.select(range)) yield [r.key, r.value];
  }

  async *valuesAsync(range?: Range<K>): AsyncIterableIterator<V> {
    for (const r of this.select(range)) yield r.value;
  }

  async *keysAsync(range?: Range<K>): AsyncIterableIterator<K> {
    for (const r of this.select(range)) yield r.key;
  }

  clear(): void {
    this.entries.clear();
  }
}

const unsupported = (what: string) => () => {
  throw new Error(`memory store: ${what} is not supported`);
};

export class MemoryKvStore implements AztecAsyncKVStore {
  private readonly maps = new Map<string, MemoryMap<Key, Value>>();

  openMap<K extends Key, V extends Value>(name: string): AztecAsyncMap<K, V> {
    let m = this.maps.get(name);
    if (!m) {
      m = new MemoryMap();
      this.maps.set(name, m);
    }
    return m as unknown as AztecAsyncMap<K, V>;
  }

  openSet = unsupported('openSet') as AztecAsyncKVStore['openSet'];
  openMultiMap = unsupported('openMultiMap') as AztecAsyncKVStore['openMultiMap'];
  openArray = unsupported('openArray') as AztecAsyncKVStore['openArray'];
  openSingleton = unsupported('openSingleton') as AztecAsyncKVStore['openSingleton'];
  openCounter = unsupported('openCounter') as AztecAsyncKVStore['openCounter'];
  backupTo = unsupported('backupTo') as AztecAsyncKVStore['backupTo'];

  transactionAsync<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  async clear(): Promise<void> {
    for (const m of this.maps.values()) m.clear();
  }

  async delete(): Promise<void> {
    this.maps.clear();
  }

  async estimateSize() {
    let numItems = 0;
    for (const m of this.maps.values()) numItems += await m.sizeAsync();
    return { mappingSize: 0, physicalFileSize: 0, actualSize: 0, numItems };
  }

  async close(): Promise<void> {
    this.maps.clear();
  }
}
