# Bundled GCI libraries

Native GemStone GCI client libraries placed here ship inside the extension's
`.vsix` and are used automatically for customers in secure / air-gapped
environments where downloading from `downloads.gemtalksystems.com` is not
permitted.

Detection lives in [`client/src/bundledGci.ts`](../../client/src/bundledGci.ts).
When a matching library is present, the login flow, Quick Setup, and the
Versions view skip the download / file-picker step and use it directly.

## Expected layout

The directory structure mirrors the extracted product distributions so the
existing `GEMSTONE` environment-variable and sibling-library resolution in
`client/src/extension.ts` works unchanged.

### Windows client

```
resources/gci/GemStone64BitClient<version>-x86.Windows_NT/bin/libgcits-<version>-64.dll
```

For example, GemStone 3.7.5:

```
resources/gci/GemStone64BitClient3.7.5-x86.Windows_NT/bin/libgcits-3.7.5-64.dll
```

Include any DLLs the GCI library depends on (its transitive dependency closure)
in the same `bin/` directory. Confirm the closure with `dumpbin /dependents`
(or `objdump -p ... | grep "DLL Name"`) against `libgcits-<version>-64.dll`.

### Currently bundled

- **3.6.2** — `libgcits-3.6.2-64.dll` + `libssl-3.6.2-64.dll` (SSL is loaded on
  demand for encrypted connections) + `msvcr100.dll`. The only non-OS dependency
  of the GemStone DLLs is the Visual C++ 2010 x64 runtime (`MSVCR100.dll`), which
  is *not* part of a clean Windows install — so it is bundled here (the x64 build,
  `coff-x86-64`) rather than relying on the VC++ 2010 redistributable being present.

## Adding a version

1. Drop the library tree under `resources/gci/` following the layout above.
2. Verify it is detected: `bundledWindowsClientVersions()` should list the
   version, and the Versions view should show it as `bundled`.
3. Because these files ship to every user, keep the set minimal — only the
   versions/platforms a bundled-build customer actually needs.
