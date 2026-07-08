/** Connection details for the Rowan-3 stone the container entrypoint started. */
export interface ContainerStone {
  version: string;
  host: string;
  stone: string;
  netldi: string;
  user: string;
  password: string;
  gciLibraryPath: string;
  /** The stone's GEMSTONE_GLOBAL_DIR; Jasper's login derives it from gemstone.rootPath. */
  globalDir: string;
}

/**
 * Read the in-container stone that `stone-entrypoint.sh` provisioned and
 * exported into the environment. Returns `undefined` outside that container
 * (e.g. a plain local run), so the Rowan e2e skips instead of failing.
 */
export function readContainerStone(): ContainerStone | undefined {
  const stone = process.env.JASPER_STONE_NAME;
  const netldi = process.env.JASPER_LDI_NAME;
  const gciLibraryPath = process.env.JASPER_GCI_LIBRARY_PATH;
  const version = process.env.JASPER_GS_VERSION;
  const globalDir = process.env.JASPER_GEMSTONE_GLOBAL_DIR;
  if (!stone || !netldi || !gciLibraryPath || !version || !globalDir) return undefined;

  return {
    version,
    host: 'localhost',
    stone,
    netldi,
    user: 'DataCurator',
    password: 'swordfish',
    gciLibraryPath,
    globalDir,
  };
}
