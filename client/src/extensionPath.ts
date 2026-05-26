import path from "path";
import os from "os";
import * as fs from "node:fs";

const EXTENSION_FOLDER = path.join(os.homedir(), '.jasper');

export function extensionPathFrom(...paths: string[]) {
    return path.join(EXTENSION_FOLDER, ...paths);
}

export function initializeExtensionFolder() {
    if (fs.existsSync(EXTENSION_FOLDER)) {
        return;
    }

    fs.mkdirSync(EXTENSION_FOLDER, {recursive: true})
}