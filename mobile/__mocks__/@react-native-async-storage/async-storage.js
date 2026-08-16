/**
 * Mock for @react-native-async-storage/async-storage (v3 API).
 * In-memory store — the native module is not available in Jest.
 */

const store = new Map();

const AsyncStorageMock = {
  getItem: key => Promise.resolve(store.has(key) ? store.get(key) : null),
  setItem: (key, value) =>
    Promise.resolve().then(() => {
      store.set(key, String(value));
    }),
  removeItem: key =>
    Promise.resolve().then(() => {
      store.delete(key);
    }),
  getMany: keys =>
    Promise.resolve().then(() => {
      const out = {};
      for (const key of keys) {
        out[key] = store.has(key) ? store.get(key) : null;
      }
      return out;
    }),
  setMany: entries =>
    Promise.resolve().then(() => {
      for (const [key, value] of Object.entries(entries)) {
        store.set(key, String(value));
      }
    }),
  removeMany: keys =>
    Promise.resolve().then(() => {
      for (const key of keys) {
        store.delete(key);
      }
    }),
  getAllKeys: () => Promise.resolve([...store.keys()]),
  clear: () =>
    Promise.resolve().then(() => {
      store.clear();
    }),
  // Legacy v2 aliases (kept for compatibility with older call sites)
  multiGet: keys =>
    Promise.resolve(keys.map(key => [key, store.has(key) ? store.get(key) : null])),
  multiSet: entries =>
    Promise.resolve().then(() => {
      for (const [key, value] of entries) {
        store.set(key, String(value));
      }
    }),
  multiRemove: keys =>
    Promise.resolve().then(() => {
      for (const key of keys) {
        store.delete(key);
      }
    }),
};

module.exports = AsyncStorageMock;
module.exports.default = AsyncStorageMock;
module.exports.__esModule = true;
