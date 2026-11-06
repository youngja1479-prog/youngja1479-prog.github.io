/**
 * GKC device migration backup — localStorage + known IndexedDB only.
 * Never collects sync passwords / auth secrets. Never executes backup content.
 */
(function (global) {
  "use strict";

  const SCHEMA = "gkc-device-backup/v1";
  const MAX_IMPORT_BYTES = 120000000; // 120 MB (decimal), not MiB

  /** Inventory from read-only audit of published apps (exact + prefixes). */
  const INVENTORY = {
    localStorageExact: [
      "gkc-study-notes-v1",
      "gkc-draw-zoom",
      "gkc-finger-mode",
      "gkc_vocab_2026_3_g1_v1",
      "neonSurvivorBest",
      "neonSurvivorMode",
      "neonSurvivorMusic",
      "neonSurvivorMuted",
      "neonSurvivorRanks",
      "neonSurvivorSettings",
      "neonSurvivorStartW",
      "neonSurvivorTips",
      "neonSurvivorProfile",
      "neonpvp_name",
      "neonDungeon.v1",
      "schoolRpgDeaths",
      "schoolRpgDeaths_v2",
    ],
    localStoragePrefixes: ["gkc-voca2-"],
    excludeLocalStorageExact: [
      "gkc-sync-pw",
      "gkc_ps_session",
    ],
    excludeLocalStoragePrefixes: [
      "gkc_session",
      "cf_clearance",
    ],
    indexedDB: [
      {
        app: "outline",
        dbName: "gkc-study-notes",
        version: 1,
        store: "data",
        keys: ["app"],
      },
    ],
  };

  const APP_LABELS = {
    outline: "목차 노트 (outline)",
    vocaRenew: "영단어 renew",
    vocaLegacy: "영단어 2026-03-g1",
    neonSurvivor: "Neon Survivor",
    neonPvp: "Neon PVP",
    neonDungeon: "Neon Dungeon",
    schoolRpg: "School RPG",
    otherKnown: "기타 등록 키",
  };

  function isExcludedKey(key) {
    if (INVENTORY.excludeLocalStorageExact.includes(key)) return true;
    return INVENTORY.excludeLocalStoragePrefixes.some((p) => key.startsWith(p));
  }

  function classifyKey(key) {
    if (key.startsWith("gkc-voca2-")) return "vocaRenew";
    if (key === "gkc_vocab_2026_3_g1_v1") return "vocaLegacy";
    if (
      key === "gkc-study-notes-v1" ||
      key === "gkc-draw-zoom" ||
      key === "gkc-finger-mode"
    )
      return "outline";
    if (key.startsWith("neonSurvivor") || key.startsWith("neonraid-gkc7-"))
      return "neonSurvivor";
    if (key === "neonpvp_name" || key.startsWith("neonpvp-")) return "neonPvp";
    if (key === "neonDungeon.v1") return "neonDungeon";
    if (key.startsWith("schoolRpgDeaths")) return "schoolRpg";
    return "otherKnown";
  }

  function collectLocalStorageKeys() {
    const found = new Set();
    for (const k of INVENTORY.localStorageExact) {
      if (!isExcludedKey(k) && localStorage.getItem(k) !== null) found.add(k);
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || isExcludedKey(k)) continue;
      for (const p of INVENTORY.localStoragePrefixes) {
        if (k.startsWith(p)) found.add(k);
      }
    }
    return [...found].sort();
  }

  async function encodeValue(value) {
    if (value instanceof Blob) {
      const buf = await value.arrayBuffer();
      return {
        __gkc_bin: true,
        t: "Blob",
        mime: value.type || "application/octet-stream",
        data_b64: bufferToB64(buf),
      };
    }
    if (value instanceof ArrayBuffer) {
      return {
        __gkc_bin: true,
        t: "ArrayBuffer",
        data_b64: bufferToB64(value),
      };
    }
    if (ArrayBuffer.isView(value)) {
      const view = value;
      return {
        __gkc_bin: true,
        t: "TypedArray",
        ctor: view.constructor.name,
        data_b64: bufferToB64(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)),
      };
    }
    return value;
  }

  async function decodeValue(value) {
    if (!value || typeof value !== "object" || value.__gkc_bin !== true) return value;
    const bytes = b64ToBuffer(value.data_b64 || "");
    if (value.t === "Blob") return new Blob([bytes], { type: value.mime || "" });
    if (value.t === "ArrayBuffer") return bytes;
    if (value.t === "TypedArray") {
      const Ctor = global[value.ctor] || Uint8Array;
      return new Ctor(bytes);
    }
    throw new Error("알 수 없는 바이너리 형식");
  }

  async function deepEncode(value, seen) {
    seen = seen || new WeakSet();
    if (value === null || typeof value !== "object") return value;
    if (
      value instanceof Blob ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value)
    ) {
      return encodeValue(value);
    }
    if (seen.has(value)) throw new Error("순환 참조는 백업할 수 없습니다");
    seen.add(value);
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await deepEncode(item, seen));
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await deepEncode(v, seen);
    }
    return out;
  }

  async function deepDecode(value) {
    if (value && typeof value === "object" && value.__gkc_bin === true) {
      return decodeValue(value);
    }
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await deepDecode(item));
      return out;
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        out[k] = await deepDecode(v);
      }
      return out;
    }
    return value;
  }

  function bufferToB64(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  function b64ToBuffer(b64) {
    const bin = atob(b64 || "");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  async function databaseExists(name) {
    if (indexedDB.databases) {
      try {
        const list = await indexedDB.databases();
        return (list || []).some((d) => d && d.name === name);
      } catch (_) {}
    }
    return null; // unknown
  }

  function openKnownDb(entry, { allowCreate } = { allowCreate: false }) {
    return new Promise(async (resolve, reject) => {
      try {
        const exists = await databaseExists(entry.dbName);
        if (exists === false && !allowCreate) {
          reject(new Error("IDB 없음: " + entry.dbName));
          return;
        }
      } catch (_) {}
      let created = false;
      const req = indexedDB.open(entry.dbName, entry.version);
      req.onerror = () => reject(req.error || new Error("IDB open failed"));
      req.onupgradeneeded = () => {
        created = true;
        if (!allowCreate) return;
        const db = req.result;
        if (![...db.objectStoreNames].includes(entry.store)) {
          db.createObjectStore(entry.store);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (created && !allowCreate) {
          db.close();
          const del = indexedDB.deleteDatabase(entry.dbName);
          del.onsuccess = () => reject(new Error("IDB 없음: " + entry.dbName));
          del.onerror = () => reject(new Error("IDB 없음: " + entry.dbName));
          return;
        }
        resolve(db);
      };
    });
  }

  function idbGet(db, storeName, key) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const r = tx.objectStore(storeName).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  function idbPut(db, storeName, key, value) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("IDB aborted"));
        tx.objectStore(storeName).put(value, key);
      } catch (e) {
        reject(e);
      }
    });
  }

  function idbGetKeyExists(db, storeName, key) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(storeName, "readonly");
        const r = tx.objectStore(storeName).getKey(key);
        r.onsuccess = () => resolve(r.result !== undefined);
        r.onerror = () => reject(r.error);
      } catch (e) {
        // getKey may be missing on very old browsers — fall back
        idbGet(db, storeName, key)
          .then((v) => resolve(v !== undefined))
          .catch(reject);
      }
    });
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const dig = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function buildBackup() {
    const apps = {};
    const lsKeys = collectLocalStorageKeys();
    const lsByApp = {};
    for (const key of lsKeys) {
      const app = classifyKey(key);
      if (!lsByApp[app]) lsByApp[app] = {};
      lsByApp[app][key] = localStorage.getItem(key);
    }

    for (const [app, map] of Object.entries(lsByApp)) {
      apps[app] = apps[app] || { localStorage: {}, indexedDB: {}, counts: {} };
      apps[app].localStorage = map;
      apps[app].counts.localStorageKeys = Object.keys(map).length;
    }

    for (const entry of INVENTORY.indexedDB) {
      const app = entry.app;
      apps[app] = apps[app] || { localStorage: {}, indexedDB: {}, counts: {} };
      try {
        const db = await openKnownDb(entry);
        try {
          if (![...db.objectStoreNames].includes(entry.store)) {
            apps[app].counts.indexedDBSkipped = (apps[app].counts.indexedDBSkipped || 0) + 1;
            continue;
          }
          const bag = {};
          let n = 0;
          for (const key of entry.keys) {
            const raw = await idbGet(db, entry.store, key);
            if (raw === undefined) continue;
            bag[key] = await deepEncode(raw);
            n++;
          }
          apps[app].indexedDB[entry.dbName] = {
            store: entry.store,
            version: entry.version,
            records: bag,
          };
          apps[app].counts.indexedDBRecords = (apps[app].counts.indexedDBRecords || 0) + n;
        } finally {
          db.close();
        }
      } catch (e) {
        apps[app].counts.indexedDBError = String(e && e.message ? e.message : e);
      }
    }

    const payload = {
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      origin: String(location.origin || ""),
      pathnameHint: String(location.pathname || ""),
      apps,
      inventoryVersion: 1,
    };
    const canonical = JSON.stringify(payload);
    payload.checksum = {
      alg: "SHA-256",
      hex: await sha256Hex(canonical),
    };
    payload.byteLengthEstimate = new TextEncoder().encode(JSON.stringify(payload)).length;
    return payload;
  }

  function validateBackupShape(obj) {
    if (!obj || typeof obj !== "object") throw new Error("백업 형식이 아닙니다");
    if (obj.schema !== SCHEMA) throw new Error("지원하지 않는 백업 버전: " + obj.schema);
    if (!obj.apps || typeof obj.apps !== "object") throw new Error("apps 항목이 없습니다");
    if (!obj.checksum || obj.checksum.alg !== "SHA-256" || typeof obj.checksum.hex !== "string") {
      throw new Error("checksum이 없습니다");
    }
    return true;
  }

  async function verifyChecksum(obj) {
    const copy = { ...obj };
    const claimed = copy.checksum;
    delete copy.checksum;
    delete copy.byteLengthEstimate;
    const hex = await sha256Hex(JSON.stringify(copy));
    if (hex !== claimed.hex) throw new Error("파일 무결성 검사 실패 (checksum)");
  }

  async function summarizeConflicts(backup) {
    const conflicts = [];
    for (const [app, data] of Object.entries(backup.apps || {})) {
      for (const key of Object.keys(data.localStorage || {})) {
        if (isExcludedKey(key)) continue;
        if (localStorage.getItem(key) !== null) {
          conflicts.push({ type: "localStorage", app, key });
        }
      }
      for (const [dbName, block] of Object.entries(data.indexedDB || {})) {
        const entry = INVENTORY.indexedDB.find((e) => e.dbName === dbName && e.app === app);
        if (!entry) continue;
        let db;
        try {
          db = await openKnownDb(entry, { allowCreate: false });
        } catch (_) {
          continue;
        }
        try {
          for (const key of Object.keys(block.records || {})) {
            if (await idbGetKeyExists(db, entry.store, key)) {
              conflicts.push({ type: "indexedDB", app, dbName, key });
            }
          }
        } finally {
          db.close();
        }
      }
    }
    return conflicts;
  }

  async function importBackup(backup, options) {
    const mode = options && options.mode ? options.mode : "empty-only";
    // empty-only | replace-chosen | replace-all-confirmed
    validateBackupShape(backup);
    await verifyChecksum(backup);

    const lsUndo = [];
    const idbUndo = [];
    const report = { written: [], skipped: [], errors: [] };

    try {
      for (const [app, data] of Object.entries(backup.apps || {})) {
        for (const [key, value] of Object.entries(data.localStorage || {})) {
          if (isExcludedKey(key)) {
            report.skipped.push({ app, key, reason: "excluded-secret" });
            continue;
          }
          if (typeof value !== "string") {
            report.skipped.push({ app, key, reason: "non-string" });
            continue;
          }
          const exists = localStorage.getItem(key) !== null;
          if (exists && mode === "empty-only") {
            report.skipped.push({ app, key, reason: "exists" });
            continue;
          }
          if (
            exists &&
            mode === "replace-chosen" &&
            options.chosenKeys &&
            !options.chosenKeys.has("ls:" + key)
          ) {
            report.skipped.push({ app, key, reason: "user-kept" });
            continue;
          }
          lsUndo.push({ key, prev: localStorage.getItem(key), had: exists });
          localStorage.setItem(key, value);
          report.written.push({ type: "localStorage", app, key });
        }

        for (const [dbName, block] of Object.entries(data.indexedDB || {})) {
          const entry = INVENTORY.indexedDB.find(
            (e) => e.dbName === dbName && e.app === app
          );
          if (!entry || entry.store !== block.store) {
            report.skipped.push({ app, dbName, reason: "unknown-idb" });
            continue;
          }
          const db = await openKnownDb(entry, { allowCreate: true });
          try {
            for (const [key, enc] of Object.entries(block.records || {})) {
              if (!entry.keys.includes(key)) {
                report.skipped.push({ app, dbName, key, reason: "unknown-key" });
                continue;
              }
              const exists = await idbGetKeyExists(db, entry.store, key);
              if (exists && mode === "empty-only") {
                report.skipped.push({ app, dbName, key, reason: "exists" });
                continue;
              }
              if (
                exists &&
                mode === "replace-chosen" &&
                options.chosenKeys &&
                !options.chosenKeys.has("idb:" + dbName + ":" + key)
              ) {
                report.skipped.push({ app, dbName, key, reason: "user-kept" });
                continue;
              }
              const prev = exists ? await idbGet(db, entry.store, key) : undefined;
              idbUndo.push({ dbName, store: entry.store, key, prev, had: exists, entry });
              const decoded = await deepDecode(enc);
              // Never treat string as HTML to execute — only structured data put
              await idbPut(db, entry.store, key, decoded);
              report.written.push({ type: "indexedDB", app, dbName, key });
            }
          } finally {
            db.close();
          }
        }
      }
      return report;
    } catch (e) {
      // rollback LS
      for (let i = lsUndo.length - 1; i >= 0; i--) {
        const u = lsUndo[i];
        try {
          if (!u.had) localStorage.removeItem(u.key);
          else localStorage.setItem(u.key, u.prev);
        } catch (_) {}
      }
      for (let i = idbUndo.length - 1; i >= 0; i--) {
        const u = idbUndo[i];
        try {
          const db = await openKnownDb(u.entry);
          try {
            if (!u.had) {
              await new Promise((resolve, reject) => {
                const tx = db.transaction(u.store, "readwrite");
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(u.store).delete(u.key);
              });
            } else {
              await idbPut(db, u.store, u.key, u.prev);
            }
          } finally {
            db.close();
          }
        } catch (_) {}
      }
      report.errors.push(String(e && e.message ? e.message : e));
      throw e;
    }
  }

  function downloadJson(obj, filename) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function readJsonFile(file) {
    if (!file) throw new Error("파일이 없습니다");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("파일이 너무 큽니다");
    const text = await file.text();
    // Refuse HTML camouflage
    const trimmed = text.trim().slice(0, 80).toLowerCase();
    if (trimmed.startsWith("<!doctype") || trimmed.startsWith("<html")) {
      throw new Error("HTML 파일은 불러올 수 없습니다");
    }
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error("JSON 파싱 실패");
    }
    validateBackupShape(obj);
    await verifyChecksum(obj);
    return obj;
  }

  function countsSummary(backup) {
    const rows = [];
    for (const [app, data] of Object.entries(backup.apps || {})) {
      rows.push({
        app,
        label: APP_LABELS[app] || app,
        ls: Object.keys(data.localStorage || {}).length,
        idb: data.counts && data.counts.indexedDBRecords ? data.counts.indexedDBRecords : 0,
      });
    }
    return rows;
  }

  global.GkcMigrationBackup = {
    SCHEMA,
    INVENTORY,
    APP_LABELS,
    isExcludedKey,
    classifyKey,
    collectLocalStorageKeys,
    buildBackup,
    validateBackupShape,
    verifyChecksum,
    summarizeConflicts,
    importBackup,
    downloadJson,
    readJsonFile,
    countsSummary,
    deepEncode,
    deepDecode,
  };
})(typeof window !== "undefined" ? window : globalThis);
