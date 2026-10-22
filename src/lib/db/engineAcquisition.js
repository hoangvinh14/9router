// Fallback is permitted only for unavailable engines before opening app data.
export async function acquireSqliteEngine(engine, load) {
  let engineModule;
  try { engineModule = await load(); }
  catch (error) {
    if (engine === "better-sqlite3" && error?.code === "ERR_MODULE_NOT_FOUND" && error.message?.startsWith("Cannot find package 'better-sqlite3' imported from ") ||
        engine === "node:sqlite" && error?.code === "ERR_UNKNOWN_BUILTIN_MODULE" && error.message === "No such built-in module: node:sqlite") return null;
    throw error;
  }
  if (engine === "better-sqlite3") {
    let probe;
    try { probe = new engineModule.default(":memory:"); }
    catch (error) {
      if (error?.code === "ERR_DLOPEN_FAILED" || error?.message?.startsWith("Could not locate the bindings file. Tried:\n") && Array.isArray(error.tries) && error.tries.length && error.tries.every(file => /[/\\]better_sqlite3\.node$/.test(file))) return null;
      throw error;
    }
    probe.close();
  }
  return engineModule;
}
export async function initializeAvailableAdapter(engine, load, factory, create) {
  if (!await acquireSqliteEngine(engine, load)) return null;
  return create(await factory());
}
