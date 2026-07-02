// Plain CJS module (not TypeScript) so it can be require()'d directly by
// client/bin/gemstone-integration-versions.js without a build step. That
// script runs in CI before the TypeScript compilation step (to determine
// which GemStone versions to test against), so it cannot depend on compiled
// output. The TypeScript declaration file (gemStoneVersion.d.ts) provides
// types for the compiled extension.

/**
 * Throws if versionString is not a 3- or 4-part numeric version (e.g. "3.6.2" or "3.6.2.1").
 * @param {string} versionString
 */
function assertIsValidVersionString(versionString) {
    if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(versionString))
        throw new Error(`Invalid version: ${versionString}`);
}

/**
 * Parses a version string into a 4-element numeric array, padding with 0 if needed.
 * @param {string} versionString
 * @returns {number[]}
 */
function parseGemStoneVersion(versionString) {
    assertIsValidVersionString(versionString);

    const segments = versionString.split('.').map(Number);

    // normalize to 4 parts so compareVersions can always iterate exactly 4
    if (segments.length === 3) segments.push(0);

    return segments;
}

/**
 * Compares two GemStone version strings.
 * @param {string} versionString
 * @param {string} anotherVersionString
 * @returns {number} Negative if versionString < anotherVersionString,
 *                   0 if equal,
 *                   positive if versionString > anotherVersionString.
 */
function compareGemStoneVersions(versionString, anotherVersionString) {
    const va = parseGemStoneVersion(versionString);
    const vb = parseGemStoneVersion(anotherVersionString);

    for (let i = 0; i < 4; i++) {
        const diff = va[i] - vb[i];
        if (diff !== 0) return diff;
    }

    return 0;
}

module.exports = { compareGemStoneVersions };
