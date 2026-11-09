class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(String(key)) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(String(key)); }
  setItem(key: string, value: string) { this.values.set(String(key), String(value)); }
}
let backing: Storage | undefined;
export function siteSessionStorage(): Storage {
  if (backing) return backing;
  try {
    const store = window.sessionStorage;
    store.setItem('entropybot.site.storage-check', '1');
    store.removeItem('entropybot.site.storage-check');
    backing = store;
  } catch { backing = new MemoryStorage(); }
  return backing;
}
class ScopedStorage implements Storage {
  constructor(private store: Storage, private prefix: string) {}
  private keys() { return Array.from({ length: this.store.length }, (_, index) => this.store.key(index)).filter((key): key is string => key !== null && key.startsWith(this.prefix)); }
  get length() { return this.keys().length; }
  clear() { for (const key of this.keys()) this.store.removeItem(key); }
  getItem(key: string) { return this.store.getItem(this.prefix + String(key)); }
  key(index: number) { const key = this.keys()[index]; return key ? key.slice(this.prefix.length) : null; }
  removeItem(key: string) { this.store.removeItem(this.prefix + String(key)); }
  setItem(key: string, value: string) { this.store.setItem(this.prefix + String(key), String(value)); }
}
export function installSiteStorage(): Storage {
  const storage = new ScopedStorage(siteSessionStorage(), 'entropybot.site.ui.v1/');
  Object.defineProperty(window, 'localStorage', { configurable: true, get: () => storage });
  return storage;
}
