import * as fs from 'fs';
import * as path from 'path';
import { RowanCatalogEntry } from './rowanCatalog';
import { metacelloLoadExpression } from './rowanMetacello';

// The default pre-load doit name used when a component doesn't already have one.
const DEFAULT_PRELOAD_DOIT = 'preload';

export interface AddDependencyResult {
  success: boolean;
  // Absolute path to the doit file written/updated.
  doitFile?: string;
  // True when the dependency was already present (nothing to do).
  alreadyPresent?: boolean;
  error?: string;
}

// Add a Metacello-baseline dependency to a Rowan project as a component
// **pre-load doit**: Rowan runs the doit (via String>>evaluate) before loading
// the component's packages, so the dependency is loaded first. Pure disk — no
// stone needed to declare it.
//
// A component has a single #preloadDoitName, so all pre-load work lives in one
// doit; adding a package appends its idiomatic Metacello load to that doit
// (creating it, and setting #preloadDoitName on the component, if absent).
export function addPreloadDependency(
  projectRoot: string,
  entry: RowanCatalogEntry,
  componentName = 'Core',
): AddDependencyResult {
  const componentsDir = path.join(projectRoot, 'rowan', 'components');
  const componentFile = path.join(componentsDir, `${componentName}.ston`);
  if (!fs.existsSync(componentFile)) {
    return {
      success: false,
      error: `Rowan component "${componentName}" not found at ${componentFile}.`,
    };
  }
  try {
    let spec = fs.readFileSync(componentFile, 'utf8');
    const existingName = spec.match(/#preloadDoitName\s*:\s*'([^']*)'/);
    const doitName = existingName ? existingName[1] : DEFAULT_PRELOAD_DOIT;
    if (!existingName) {
      // Add #preloadDoitName right after #name : '...' (Rowan omits nil fields,
      // so a freshly-created component has no preload doit line yet).
      const withField = spec.replace(
        /(#name\s*:\s*'[^']*',\n)/,
        `$1\t#preloadDoitName : '${doitName}',\n`,
      );
      if (withField === spec) {
        return { success: false, error: `Could not add a pre-load doit to ${componentName}.ston.` };
      }
      spec = withField;
      fs.writeFileSync(componentFile, spec);
    }

    const doitFile = path.join(componentsDir, `${doitName}.st`);
    const existing = fs.existsSync(doitFile) ? fs.readFileSync(doitFile, 'utf8') : '';
    // Idempotent: this baseline+repository already loaded by the doit.
    if (existing.includes(entry.repository)) {
      return { success: true, doitFile, alreadyPresent: true };
    }
    const load = metacelloLoadExpression(entry);
    const contents =
      existing.trim().length > 0 ? `${existing.replace(/\n*$/, '')}\n\n${load}\n` : `${load}\n`;
    fs.writeFileSync(doitFile, contents);
    return { success: true, doitFile };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
