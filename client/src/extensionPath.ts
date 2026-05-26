import path from "path";
import os from "os";

const EXTENSION_FOLDER = path.join(os.homedir(), '.jasper');

export function extensionPathFrom(...paths: string[]) {
    return path.join(EXTENSION_FOLDER, ...paths);
}