#!/usr/bin/env node
//
// Lists the GemStone versions available for integration testing.
//
//   node gemstone-integration-versions.js            → JSON array of all versions, oldest first
//   node gemstone-integration-versions.js --oldest   → just the oldest version string
//
// Versions come from .gemstone-integration-releases.json. Other scripts use
// this to pick which GemStone build to download and run tests against.

const fs = require('fs');
const { compareGemStoneVersions } = require('../src/gemStoneVersion.js');

const releasesFileContents = fs.readFileSync(`${__dirname}/../.gemstone-integration-releases.json`, 'utf8');
const releasesInAscendingOrder = JSON.parse(releasesFileContents)
    .sort((release, anotherRelease) => compareGemStoneVersions(release.version, anotherRelease.version));

if (process.argv.includes('--oldest')) {
    console.log(releasesInAscendingOrder[0].version);
    return;
}

console.log(JSON.stringify(releasesInAscendingOrder.map(release => release.version)));
