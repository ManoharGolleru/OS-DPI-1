import { openDB } from "idb";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { fileSave } from "browser-fs-access";
import Globals from "./globals";

export class DB {
  constructor() {
    this.dbPromise = openDB("os-dpi", 6, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 6) {
          let logStore = db.createObjectStore("logstore", {
            keyPath: "id",
            autoIncrement: true,
          });
          logStore.createIndex("by-name", "name");
        }
        if (oldVersion < 5) {
          let store5 = db.createObjectStore("store5", {
            keyPath: ["name", "type"],
          });
          store5.createIndex("by-name", "name");
          if (oldVersion == 4) {
            // copy data from old store to new
            const store4 = transaction.objectStore("store");
            for await (const cursor of store4) {
              const record4 = cursor.value;
              store5.put(record4);
            }
            db.deleteObjectStore("store");
            // add an etag index to url store
            transaction.objectStore("url").createIndex("by-etag", "etag");
          } else if (oldVersion < 4) {
            db.createObjectStore("media");
            let savedStore = db.createObjectStore("saved", {
              keyPath: "name",
            });
            savedStore.createIndex("by-etag", "etag");
            // track etags for urls
            const urlStore = db.createObjectStore("url", {
              keyPath: "url",
            });
            // add an etag index to the url store
            urlStore.createIndex("by-etag", "etag");
          }
        }
      },
      blocked(_currentVersion, _blockedVersion, _event) {},
      blocking(_currentVersion, _blockedVersion, _event) {
        window.location.reload();
      },
      terminated() {},
    });
    /** @type {Function[]} */
    this.updateListeners = [];
    this.designName = "";
    this.fileName = "";
    this.fileHandle = null;
    this.fileVersion = 0.0;
    this.fileUid = "";
    /** Track whether there are unsaved changes for beforeunload warning */
    this.hasUnsavedChanges = false;
    /** Native writes already started by editor changes or init actions. */
    this.pendingWrites = new Set();
  }

  /** set the name for the current design
   * @param {string} name
   */
  setDesignName(name) {
    this.designName = name;
    document.title = name;
  }

  /** rename the design
   * @param {string} newName
   */
  async renameDesign(newName) {
    const db = await this.dbPromise;
    newName = await this.uniqueName(newName);
    const tx = db.transaction(["store5", "media", "saved"], "readwrite");
    const index = tx.objectStore("store5").index("by-name");
    for await (const cursor of index.iterate(this.designName)) {
      const record = { ...cursor.value, name: newName };
      cursor.delete();
      tx.objectStore("store5").put(record);
    }
    const mst = tx.objectStore("media");
    for await (const cursor of mst.iterate()) {
      if (cursor && (/** @type {IDBValidKey[]} */ (cursor.key))[0] == this.designName) {
        const record = { ...cursor.value };
        const key = /** @type {IDBValidKey[]} */ (cursor.key);
        cursor.delete();
        key[0] = newName;
        mst.put(record, key);
      }
    }
    const cursor = await tx.objectStore("saved").openCursor(this.designName);
    if (cursor) {
      cursor.delete();
    }
    await tx.done;
    this.fileHandle = null;
    this.fileName = "";

    this.notify({ action: "rename", name: this.designName, newName });
    this.designName = newName;
  }

  /**
   * return list of names of designs in the db
   * @returns {Promise<string[]>}
   */
  async names() {
    const db = await this.dbPromise;
    const keys = await db.getAllKeysFromIndex("store5", "by-name");
    const result = [...new Set(keys.map((key) => (/** @type {[string, string]} */ (key))[0]))];
    return result;
  }

  /**
   * return list of names of saved designs in the db
   * @returns {Promise<string[]>}
   */
  async saved() {
    const db = await this.dbPromise;
    const result = [];
    for (const key of await db.getAllKeys("saved")) {
      result.push(key.toString());
    }
    return result;
  }

  /**
   * Create a unique name for new design
   * @param {string} name - the desired name
   * @returns {Promise<string>}
   */
  async uniqueName(name = "new") {
    // strip off any suffix
    name = name.replace(/\.osdpi$|\.zip$/, "");
    // strip any -number off the end of base
    name = name.replace(/-\d+$/, "") || name;
    // replace characters we don't want with _
    name = name.replaceAll(/[^a-zA-Z0-9]/g, "_");
    // replace multiple _ with one
    name = name.replaceAll(/_+/g, "_");
    // remove trailing _
    name = name.replace(/_+$/, "");
    // remove leading _
    name = name.replace(/^_+/, "");
    // if we're left with nothing the call it noname
    name = name || "noname";
    const allNames = await this.names();
    if (allNames.indexOf(name) < 0) return name;
    const base = name;
    for (let i = 1; ; i++) {
      const name = `${base}-${i}`;
      if (allNames.indexOf(name) < 0) return name;
    }
  }

  /** Return the record for type or the defaultValue
   * @param {string} type
   * @param {any} defaultValue
   * @returns {Promise<Object>}
   */
  async read(type, defaultValue = {}) {
    const db = await this.dbPromise;
    const record = await db.get("store5", [this.designName, type]);
    let data = record ? record.data : defaultValue;
    data = JSON.parse(
      JSON.stringify(data, (_key, value) => {
        if (typeof value === "string") {
          return value.normalize("NFC"); // Use NFC normalization form
        }
        return value;
      }),
    );

    return data;
  }

  /**
   * Read log records
   *
   * @returns {Promise<Object[]>}
   */
  async readLog() {
    const db = await this.dbPromise;
    const index = db.transaction("logstore", "readonly").store.index("by-name");
    const key = this.designName;
    const result = [];
    for await (const cursor of index.iterate(key)) {
      const data = cursor.value.data;
      result.push(data);
    }
    return result;
  }

  /** Write a design record
   * @param {string} type
   * @param {Object} data
   */
  write(type, data) {
    // A board switch during an await must not move this write to another board.
    const name = this.designName;
    const pending = (async () => {
      this.hasUnsavedChanges = true;
      const db = await this.dbPromise;
      // normalize the data for unicode issues
      data = JSON.parse(
        JSON.stringify(data, (_key, value) => {
          if (typeof value === "string") {
            return value.normalize("NFC"); // Use NFC normalization form
          }
          return value;
        }),
      );

      // do all this in a transaction
      const tx = db.transaction(["store5", "saved"], "readwrite");
      // note that this design has been updated
      await tx.objectStore("saved").delete(name);
      // add the record to the store
      const store = tx.objectStore("store5");
      await store.put({ name, type, data });
      await tx.done;

      this.notify({ action: "update", name });
    })();
    this.pendingWrites.add(pending);
    pending.then(
      () => this.pendingWrites.delete(pending),
      () => this.pendingWrites.delete(pending),
    );
    return pending;
  }

  /** Wait for writes already started by the native editor or init actions.
   * Drain all writes even when one fails so transaction rollback is ordered.
   */
  async settleWrites() {
    const failed = [];
    while (this.pendingWrites.size) {
      const results = await Promise.allSettled([...this.pendingWrites]);
      failed.push(...results.filter(result => result.status === "rejected"));
    }
    if (failed.length) throw failed[0].reason;
  }

  /** Write a log record
   * @param {Object} data
   */
  async writeLog(data) {
    const db = await this.dbPromise;
    const tx = db.transaction(["logstore"], "readwrite");
    tx.objectStore("logstore").put({ name: this.designName, data });
    await tx.done;
  }

  /**
   * delete records of this type
   *
   * @param {string} type
   * @returns {Promise<void>}
   */
  async clear(type) {
    const db = await this.dbPromise;
    return db.delete("store5", [this.designName, type]);
  }

  /**
   * delete log records
   *
   * @returns {Promise<void>}
   */
  /** @param {string} [name] defaults to the current design */
  async clearLog(name = this.designName) {
    const db = await this.dbPromise;
    const tx = db.transaction("logstore", "readwrite");
    const index = tx.store.index("by-name");
    for await (const cursor of index.iterate(name)) {
      cursor.delete();
    }
    await tx.done;
  }

  /** Read a design from a local file
   * @param {import("browser-fs-access").FileWithHandle} file
   */
  async readDesignFromFile(file) {
    // keep the handle so we can save to it later
    this.fileHandle = file.handle;
    return this.readDesignFromBlob(file, file.name);
  }

  /** Read a design from a URL
   * @param {string} url
   * @param {string} [name]
   * @returns {Promise<boolean>}
   */
  async readDesignFromURL(url, name = "") {
    if (!url) return false;
    let design_url = url;
    /** @type {Response} */
    let response;
    const db = await this.dbPromise;

    // a local URL
    if (!url.startsWith("http")) {
      response = await fetch(url);
    } else {
      // allow for the url to point to HTML that contains the link
      if (!url.match(/.*\.(osdpi|zip)$/)) {
        response = await fetch("https://gb.cs.unc.edu/cors/", {
          headers: { "Target-URL": url },
        });
        if (!response.ok) {
          throw new Error(
            `Fetching the URL (${url}) failed: ${response.status}`,
          );
        }
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        // find the first link that matches the name
        const link =
          doc.querySelector(`a[href$="${name}.zip"]`) ||
          doc.querySelector(`a[href$="${name}.osdpi"]`);
        if (link instanceof HTMLAnchorElement) {
          design_url = link.href;
        } else {
          throw new Error(`Invalid URL ${url}`);
        }
      }
      // have we seen this url before?
      const urlRecord = await db.get("url", design_url);
      /** @type {HeadersInit} */
      const headers = {}; // for the fetch
      if (urlRecord) {
        /** @type {string} */
        const etag = urlRecord.etag;
        // do we have any saved designs with this etag?
        const savedKey = await db.getKeyFromIndex("saved", "by-etag", etag);
        if (savedKey) {
          // yes we have a previously saved design from this url
          // set the headers to check if it has changed
          headers["If-None-Match"] = etag;
          name = savedKey.toString();
        }
      }
      headers["Target-URL"] = design_url;

      response = await fetch("https://gb.cs.unc.edu/cors/", { headers });
    }
    if (response.status == 304) {
      // we already have it
      this.designName = name;
      return false;
    }
    if (!response.ok) {
      throw new Error(`Fetching the URL (${url}) failed: ${response.status}`);
    }

    const etag = response.headers.get("ETag") || "";
    await db.put("url", { url: design_url, page_url: url, etag });

    if (!name) {
      const urlParts = new URL(design_url, window.location.origin);
      const pathParts = urlParts.pathname.split("/");
      if (
        pathParts.length > 0 &&
        (pathParts[pathParts.length - 1].endsWith(".osdpi") ||
          pathParts[pathParts.length - 1].endsWith(".zip"))
      ) {
        name = pathParts[pathParts.length - 1];
      } else {
        throw new Error(`Design files should have .osdpi suffix`);
      }
    }

    const blob = await response.blob();

    // parse the URL
    return this.readDesignFromBlob(blob, name, etag);
  }

  /** Return the URL (if any) this design was imported from
   * @returns {Promise<string>}
   */
  async getDesignURL() {
    const db = await this.dbPromise;

    const name = this.designName;

    // check saved
    const savedRecord = await db.get("saved", name);
    if (savedRecord && savedRecord.etag && savedRecord.etag != "none") {
      // lookup the URL
      const etag = savedRecord.etag;
      const urlRecord = await db.getFromIndex("url", "by-etag", etag);
      if (urlRecord) {
        const url = urlRecord.page_url;
        return url;
      }
    }
    return "";
  }

  /**
   * Reload the design from a URL if and only if:
   * 1. It was loaded from a URL
   * 2. It has not been edited
   * 3. The ETag has changed
   */
  async reloadDesignFromOriginalURL() {
    const url = await this.getDesignURL();
    if (url) {
      if (await this.readDesignFromURL(url)) {
        Globals.restart();
      }
    }
  }

  /** Read design from the blob
   * @param {Blob} blob
   * @param {string} filename
   * @param {string} etag
   * @returns {Promise<boolean>}
   */
  async readDesignFromBlob(blob, filename, etag = "") {
    const design = await unPackDesign(blob); // validate before changing names or records
    const database = await this.dbPromise;
    const name = etag ? filename.replace(/\.(zip|osdpi)$/, "") : await this.uniqueName(filename);
    const tx = database.transaction(["store5", "media", "saved"], "readwrite");
    for (const [type, data] of Object.entries(design)) {
      if (type === "media") {
        for (const asset of data) tx.objectStore("media").put({name:asset.name,content:asset.content},[name,asset.name]);
      } else tx.objectStore("store5").put({name,type,data});
    }
    tx.objectStore("saved").put({name,etag});
    await tx.done;
    this.fileName = filename;
    this.designName = name;
    this.notify({action:"update",name});
    return true;
  }

  // do this part async to avoid file picker timeout
  /**
   * Converts the current design data into a Blob object containing a zipped archive.
   * The archive includes layout, actions, content, method, pattern, cues, and associated media files.
   *
   * @async
   * @function convertDesignToBlob
   * @returns {Promise<Blob>} A Promise that resolves with a Blob object representing the zipped design data.
   * @throws {Error} Will throw an error if database operations fail or if zipping encounters an issue.
   */
  async convertDesignToBlob() {
    const db = await this.dbPromise;
    // collect the parts of the design
    const layout = Globals.layout?.toObject() ?? {};
    const actions = Globals.actions?.toObject() ?? [];
    const content = Globals.data?.contentRows ?? await this.read("content");
    const method = Globals.methods?.toObject() ?? {};
    const pattern = Globals.patterns?.toObject() ?? {};
    const cues = Globals.cues?.toObject() ?? {};

    const zipargs = {
      "layout.json": strToU8(JSON.stringify(layout)),
      "actions.json": strToU8(JSON.stringify(actions)),
      "content.json": strToU8(JSON.stringify(content)),
      "method.json": strToU8(JSON.stringify(method)),
      "pattern.json": strToU8(JSON.stringify(pattern)),
      "cues.json": strToU8(JSON.stringify(cues)),
    };

    // Retain optional native sections (for example notes) on export.
    for (const record of await db.getAllFromIndex("store5", "by-name", this.designName)) {
      const filename = record.type + ".json";
      if (!(filename in zipargs)) {
        assertArchiveName(filename);
        zipargs[filename] = strToU8(JSON.stringify(record.data));
      }
    }
    const mediaKeys = (await db.getAllKeys("media")).filter(pair => pair[0] === this.designName);

    // add the encoded image to the zipargs
    for (const key of mediaKeys) {
      const record = await db.get("media", key);
      if (record) {
        const contentBuf = await record.content.arrayBuffer();
        const contentArray = new Uint8Array(contentBuf);
        const mediaKey = /** @type {[string, string]} */ (key);
        assertArchiveName(mediaKey[1]);
        if (Object.hasOwn(zipargs, mediaKey[1])) throw new Error("A resource conflicts with a native section: " + mediaKey[1]);
        (/** @type {Record<string, Uint8Array>} */ (zipargs))[mediaKey[1]] = contentArray;
      }
    }

    // zip it
    const zip = zipSync(zipargs);
    // create a blob from the zipped result
    const blob = new Blob([zip], { type: "application/octet-stream" });
    return blob;
  }

  /**
   * Saves the current design as a .osdpi or .zip file using the fileSave library.
   * The design is first converted into a Blob object containing a zipped archive,
   * then saved to the user's file system.  Also saves the design name in the "saved" table of the db.
   *
   * @async
   * @function saveDesign
   * @returns {Promise<void>} A Promise that resolves when the design is successfully saved.
   * @throws {Error} Logs an error to the console if the export fails.
   */
  async saveDesign() {
    const db = await this.dbPromise;

    const options = {
      fileName: this.fileName || this.designName + ".osdpi",
      extensions: [".osdpi", ".zip"],
      id: "osdpi",
    };
    try {
      await fileSave(this.convertDesignToBlob(), options, this.fileHandle);
      await db.put("saved", { name: this.designName });
      this.hasUnsavedChanges = false;
    } catch (error) {
      console.error("Export failed");
      console.error(error);
    }
  }

  /** Unload a design from the database
   * @param {string} name - the name of the design to delete
   */
  async unload(name) {
    const db = await this.dbPromise;
    const tx = db.transaction("store5", "readwrite");
    const index = tx.store.index("by-name");
    for await (const cursor of index.iterate(name)) {
      cursor.delete();
    }
    await tx.done;
    // delete media
    const txm = db.transaction("media", "readwrite");
    const mediaKeys = (await txm.store.getAllKeys()).filter(
      (pair) => Object.values(pair)[0] == name,
    );

    // delete the media
    for (const key of mediaKeys) {
      await txm.store.delete(key);
    }
    await txm.done;
    await db.delete("saved", name);
    this.notify({ action: "unload", name });
  }

  /** Return an image from the database
   * @param {string} name
   * @returns {Promise<HTMLImageElement>}
   */
  async getImage(name) {
    const db = await this.dbPromise;
    const record = await db.get("media", [this.designName, name]);
    const img = new Image();
    if (record) {
      img.src = URL.createObjectURL(record.content);
    }
    img.title = record.name;
    return img;
  }

  /** Return an image blob from the database
   * @param {string} name
   * @returns {Promise<Blob>}
   */
  async getImageBlob(name) {
    const db = await this.dbPromise;
    const record = await db.get("media", [this.designName, name]);
    return record.content;
  }

  /** Return an audio file from the database
   * @param {string} name
   * @returns {Promise<HTMLAudioElement>}
   */
  async getAudio(name) {
    const db = await this.dbPromise;
    const record = await db.get("media", [this.designName, name]);
    const audio = new Audio();
    if (record) {
      audio.src = URL.createObjectURL(record.content);
    }
    return audio;
  }

  /** Return an image URL from the database
   * @param {string} name
   * @returns {Promise<string>}
   */
  async getMediaURL(name) {
    const db = await this.dbPromise;
    name = name.normalize("NFC");
    const record = await db.get("media", [this.designName, name]);
    if (record) return URL.createObjectURL(record.content);
    else return "";
  }

  /** Add media to the database
   * @param {Blob} blob
   * @param {string} name
   */
  async addMedia(blob, name) {
    const db = await this.dbPromise;
    name = name.normalize("NFC");
    return await db.put(
      "media",
      {
        name: name,
        content: blob,
      },
      [this.designName, name],
    );
  }

  /** List media entries from a given store
   * @returns {Promise<string[]>}
   * */
  async listMedia() {
    const db = await this.dbPromise;
    const keys = (await db.getAllKeys("media")).filter(
      (key) => (/** @type {IDBValidKey[]} */ (key))[0] == this.designName, //only show resources from this design
    );
    const result = [];
    for (const key of keys) {
      result.push(String((/** @type {IDBValidKey[]} */ (key))[1]));
    }
    return result;
  }

  /** delete media files
   * @param {string[]} names
   */
  async deleteMedia(...names) {
    const db = await this.dbPromise;
    const tx = db.transaction(["media", "saved"], "readwrite");
    const mst = tx.objectStore("media");
    for await (const cursor of mst.iterate()) {
      if (
        cursor &&
        (/** @type {IDBValidKey[]} */ (cursor.key))[0] == this.designName &&
        names.includes(/** @type {string} */ ((/** @type {IDBValidKey[]} */ (cursor.key))[1]))
      ) {
        cursor.delete();
      }
    }
    const cursor = await tx.objectStore("saved").openCursor(this.designName);
    if (cursor) {
      cursor.delete();
    }
    await tx.done;
  }

  /** Listen for database update
   * @param {(message: UpdateNotification) =>void} callback
   */
  addUpdateListener(callback) {
    this.updateListeners.push(callback);
  }

  /** Notify listeners of database update
   * @param {UpdateNotification} message
   */
  notify(message) {
    for (const listener of this.updateListeners) {
      listener(message);
    }
  }
}

export default new DB();

/** Convert a blob into an array buffer
 * @param {Blob} blob */
function readAsArrayBuffer(blob) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onloadend = () => fr.result instanceof ArrayBuffer && resolve(fr.result);
    fr.readAsArrayBuffer(blob);
  });
}

/** Reject unsafe names and unreasonably large archives without discarding resources. */
function assertArchiveName(name) {
  if (!name || /^[\/\\]/.test(name) || /\\|[\x00-\x1f]/.test(name) ||
      name.split("/").some(p => !p || p === "." || p === "..") || ["__proto__","constructor","prototype"].includes(name))
    throw new Error("Unsafe archive entry: " + name);
}
export async function unPackDesign(blob) {
  if (blob.size > 100 * 1024 * 1024) throw new Error("The design exceeds the 100 MB import limit.");
  const input = new Uint8Array(await blob.arrayBuffer());
  let total = 0, count = 0;
  const names = new Set();
  const unzipped = unzipSync(input, {filter: entry => {
    if (entry.name.endsWith("/")) return false;
    assertArchiveName(entry.name);
    if (names.has(entry.name)) throw new Error("Duplicate archive entry: " + entry.name);
    names.add(entry.name);
    total += entry.originalSize;
    if (++count > 4096 || total > 200 * 1024 * 1024) throw new Error("The expanded design exceeds the safe import limit.");
    return true;
  }});
  const result = {}, media = [];
  const nativeNames = new Set(["layout","content","actions","method","pattern","cues","notes"]);
  for (const [filename,bytes] of Object.entries(unzipped)) {
    const section = filename.replace(/\.json$/, "");
    if (filename === section + ".json" && nativeNames.has(section)) {
      try { result[section] = JSON.parse(strFromU8(bytes)); }
      catch { throw new Error("Invalid JSON in " + filename + ". Nothing was imported."); }
    } else {
      // Images, audio, videos, fonts and extra files survive import/export intact.
      media.push({name:filename,content:new Blob([bytes],{type:mime(filename)||"application/octet-stream"})});
    }
  }
  if (media.length) result.media = media;
  return result;
}

const mimetypes = {
  ".json": "application/json",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".mp4": "audio/mp4",
  ".oga": "audio/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".webm": "video/webm",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};
/** Map filenames to mimetypes for unpacking the zip file
 * @param {string} fname
 */
function mime(fname) {
  const extension = /\.[-a-zA-Z0-9]+$/.exec(fname);
  if (!extension) return false;
  return (/** @type {Record<string, string>} */ (mimetypes))[extension[0]] || false;
}
