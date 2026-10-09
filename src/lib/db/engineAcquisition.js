// Only this pre-application-file acquisition stage may admit engine fallback.
// Unknown import errors and all application factory errors propagate unchanged.
function missingPackage(error, engine) {
  return error?.code === 'ERR_MODULE_NOT_FOUND' &&
    error.message?.startsWith(`Cannot find package '${engine}' imported from `);
}
function missingBuiltin(error, engine) {
  return error?.code === 'ERR_UNKNOWN_BUILTIN_MODULE' &&
    error.message === `No such built-in module: ${engine}`;
}
export async function acquireSqliteEngine(engine, load) {
  let engineModule;
  try { engineModule = await load(); }
  catch (error) {
    if ((engine === 'better-sqlite3' && missingPackage(error, engine)) ||
        (engine === 'node:sqlite' && missingBuiltin(error, engine))) return null;
    throw error;
  }
  if (engine !== 'better-sqlite3') return engineModule;
  // better-sqlite3 loads its native binding lazily on construction (installed
  // database.js). Probe only :memory:, never the configured application path.
  let probe;
  try { probe = new engineModule.default(':memory:'); }
  catch (error) {
    const missingBinding = error?.message?.startsWith('Could not locate the bindings file. Tried:\n') &&
      Array.isArray(error.tries) && error.tries.length > 0 &&
      error.tries.every(file => typeof file === 'string' && /[/\\]better_sqlite3\.node$/.test(file));
    if (missingBinding || error?.code === 'ERR_DLOPEN_FAILED') return null;
    throw error;
  }
  // Cleanup errors are not engine availability and must stop selection.
  probe.close();
  return engineModule;
}
export async function initializeAvailableAdapter(engine, loadEngine, loadFactory, create) {
  if (!await acquireSqliteEngine(engine, loadEngine)) {
    console.warn(`[DB] ${engine} engine unavailable before database open`);
    return null;
  }
  // Missing/broken project module and factory/open/validation/durability errors
  // are fatal, including errors with misleading engine-loader-like messages.
  return create(await loadFactory());
}
