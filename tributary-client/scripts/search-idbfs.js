/**
 * Browser console snippet: search all IndexedDB databases for a string.
 *
 * Usage (paste into web console):
 *   searchIdbfs("some secret term").then(console.log)
 *
 * Returns an object mapping each database name to whether the needle was found
 * in any raw binary content stored in that database.
 */

async function searchIdbfs(needle) {
  const encoded = new TextEncoder().encode(needle);

  function containsString(haystack, encoded) {
    for (let i = 0; i <= haystack.length - encoded.length; i++) {
      let match = true;
      for (let j = 0; j < encoded.length; j++) {
        if (haystack[i + j] !== encoded[j]) { match = false; break; }
      }
      if (match) return true;
    }
    return false;
  }

  function dumpDB(dbName) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length === 0) { db.close(); resolve([]); return; }
        const tx = db.transaction(storeNames, "readonly");
        const chunks = [];
        let pending = storeNames.length;
        for (const storeName of storeNames) {
          const cursor = tx.objectStore(storeName).openCursor();
          cursor.onsuccess = function () {
            const c = cursor.result;
            if (c) {
              const val = c.value;
              if (val?.contents instanceof Uint8Array && val.contents.length > 0) {
                chunks.push(val.contents);
              }
              c.continue();
            } else {
              pending--;
              if (pending === 0) { db.close(); resolve(chunks); }
            }
          };
          cursor.onerror = () => { pending--; if (pending === 0) { db.close(); resolve(chunks); } };
        }
      };
    });
  }

  const databases = await indexedDB.databases();
  const results = {};
  for (const { name } of databases) {
    if (!name) continue;
    const chunks = await dumpDB(name);
    const found = chunks.some(chunk => containsString(chunk, encoded));
    results[name] = { found, chunksScanned: chunks.length };
  }

  console.table(results);
  return results;
}
