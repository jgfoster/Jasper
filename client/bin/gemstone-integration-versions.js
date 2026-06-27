#!/usr/bin/env node
//
// Lists the GemStone versions available for integration testing.
//
//   node gemstone-integration-versions.js            → JSON array of all versions, oldest first
//   node gemstone-integration-versions.js --latest   → just the latest version string
//
// Versions come from .gemstone-integration-releases.json. Other scripts use
// this to pick which GemStone build to download and run tests against.

const fs = require('fs');

const releasesFileContents = fs.readFileSync(`${__dirname}/../.gemstone-integration-releases.json`, 'utf8');
const releases = JSON.parse(releasesFileContents)
    .sort((release, anotherRelease) => compareVersions(release.version, anotherRelease.version));

function compareVersions(versionString, anotherVersionString) {
    const version = parseVersion(versionString);
    const anotherVersion = parseVersion(anotherVersionString);
    
    for (let segmentIndex = 0; segmentIndex < 4; segmentIndex++) {
        const difference = version[segmentIndex] - anotherVersion[segmentIndex];
        if (difference !== 0) return difference;
    }
    
    return 0;
}

function parseVersion(versionString) {
    assertIsValidVersionString(versionString);
    
    const segments = versionString.split('.').map(Number);

    // normalize to 4 parts so compareVersions can always iterate exactly 4
    if (segments.length === 3) segments.push(0);
    
    return segments;
}

function assertIsValidVersionString(versionString) {
    if (!/^\d+\.\d+\.\d+(\.\d+)?$/.test(versionString))
        throw new Error(`Invalid version: ${versionString}`);
}

if (process.argv.includes('--latest')) {
    console.log(releases[releases.length - 1].version);
    return;
}

console.log(JSON.stringify(releases.map(release => release.version)));
