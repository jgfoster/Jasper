# Enhanced Inspector Support for GemStone

Loads enhanced inspector support into a plain-vanilla GemStone server.

> **Note:** the payload `.gs` files now live in `resources/enhancedInspector/`
> (so they ship in the packaged VSIX). The scripts here operate on that
> directory; only the developer scripts remain in `docs/gtSupport/`.

## Quick Start

1. Start your stone and ensure a `.topazini` file is present in the current directory.
2. Set `$GEMSTONE` to the GemStone product directory.
3. Run:
   ```
   /path/to/gtSupport/load_gemstone_gt_support.sh
   ```

## Scripts

- **`load_gemstone_gt_support.sh`** — loads the seven `.gs` files into a running stone. This is all you need.
- **`update_gemstone_gt_support.sh`** — refreshes the `.gs` files from the feenk project checkouts in `$ROWAN_PROJECTS_HOME`. Run this when the feenk projects have been updated.

## Updating the .gs Files

Set `$ROWAN_PROJECTS_HOME` to the directory containing the four feenk project clones,
pull the latest from each repo (see the comments in that script for the repo list),
then run the update script:
```
./update_gemstone_gt_support.sh
```

## Use with Acme Licensing Demo

Log in to Topaz as DataCurator and input `IMCSystem-gtViews.gs` (no script for this one).
