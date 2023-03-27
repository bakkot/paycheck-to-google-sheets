// based in part on https://github.com/googleworkspace/node-samples/blob/030acbecc4cca4fd45428f91f849f172132b5ed4/sheets/quickstart/index.js

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import * as googleapis from 'googleapis';

import { authorize } from './google-cloud-auth.mjs';
import { readAndParse } from './parse.mjs';
import spreadsheetData from './spreadsheet-data.json' assert { type: 'json' };

if (import.meta.url !== pathToFileURL(process.argv[1]).href) {
  throw new Error('designed to be used from CLI');
}

let { id: spreadsheetId, columns } = spreadsheetData;

if (Object.values(columns).some(k => k != null && (k.length !== 1 || k.toUpperCase() !== k))) {
  throw new Error('have not yet implemented multiple-letter columns');
}
if (columns.date == null) {
  throw new Error('must have a non-null date column');
}
if (columns.net === void 0) {
  throw new Error('must have a "net" column (set to `null` to explicitly ignore)');
}
if (columns.gross === void 0) {
  throw new Error('must have a "gross" column (set to `null` to explicitly ignore)');
}

function penniesToString(int) {
  return (int / 100).toFixed(2); // eh...
}

let knownColumnKeys = Object.values(columns).filter(k => k != null).sort();
let firstCol = knownColumnKeys[0];
let lastCol = knownColumnKeys.at(-1);
let allColumnKeys = Array.from({ length: lastCol.charCodeAt(0) - firstCol.charCodeAt(0) + 1 })
  .map((_, i) => String.fromCharCode(i + firstCol.charCodeAt(0)));

let dir = process.argv[2];
if (process.argv.length !== 3 && process.argv.length !== 4) {
  console.error('Usage: node upload.mjs path-to-paychecks [first-date]');
  process.exit(0);
}
let firstDate = process.argv[3] ?? '0';
if (!fs.existsSync(dir)) {
  console.error(`can't find ${dir}`);
  process.exit(1);
}

let auth = await authorize();
let sheets = googleapis.google.sheets({version: 'v4', auth});

let existingDates = (await sheets.spreadsheets.values.get({
  spreadsheetId,
  range: `${columns.date}:${columns.date}`,
})).data.values.map(v => v[0]);

let existingDatesSet = new Set(existingDates);

let paths = fs.lstatSync(dir).isDirectory()
  ? fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).map(f => path.join(dir, f))
  : [dir];

async function pdfsToData(paths) {
  let parsed = [];
  for (let item of paths) {
    let dateM = item.match(/(?:_|\b)(20[0-9][0-9]-[0-9][0-9]-[0-9][0-9])\.pdf$/);
    if (dateM == null) {
      if (item.match(/(?:_|\b)(20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]) \([0-9]+\)\.pdf$/)) {
        console.log(`skipping ${item}`);
        continue;
      }
      throw new Error(`could not parse date from filename: ${item}; expected "20XX-XX-XX.pdf"`);
    }
    let date = dateM[1];
    if (date < firstDate) {
      continue;
    }
    if (existingDatesSet.has(date)) {
      console.log(`skipping ${item} since ${date} is already present in the spreadsheet`);
      continue;
    }
    let data = await readAndParse(item);
    for (let key of Object.keys(data.deductions)) {
      if (!(key in columns)) {
        throw new Error(`unknown column ${JSON.stringify(key)} in ${item}`);
      }
    }
    for (let i = 0; i < data.deposits.length; ++i) {
      if (!(`deposits-${i+1}` in columns)) {
        throw new Error(`no column for deposits-${i+1}`);
      }
    }
    data.date = date;
    parsed.push(data);
  }

  parsed.sort((a, b) => a.date > b.date ? 1 : -1);
  return parsed.map(data => {
    let asEntries = Object.fromEntries(allColumnKeys.map(k => [k, '0']));
    // we know all the values we're setting are already in the object because we checked columns above
    asEntries[columns.date] = data.date;
    if (columns.gross != null) {
      asEntries[columns.gross] = penniesToString(data.gross);
    }
    if (columns.net != null) {
      asEntries[columns.net] = penniesToString(data.net);
    }
    for (let [key, value] of Object.entries(data.deductions)) {
      if (columns[key] == null) continue;
      asEntries[columns[key]] = penniesToString(value);
    }
    for (let i = 0; i < data.deposits.length; ++i) {
      let key = `deposits-${i+1}`;
      if (columns[key] == null) continue;
      asEntries[columns[key]] = penniesToString(data.deposits[i]);
    }
    return Object.values(asEntries);
  });
}

let data = await pdfsToData(paths);
// console.log();
if (data.length === 0) {
  console.log('no new entries found');
  process.exit(0);
}

let firstRow = existingDates.length + 1;
let range = `${firstCol}${firstRow}:${lastCol}${firstRow + data.length - 1}`;

let res = await sheets.spreadsheets.values.update({
  spreadsheetId,
  range,
  valueInputOption: 'USER_ENTERED',
  resource: { range, majorDimension: 'ROWS', values: data },
});
if (res.statusText === 'OK') {
  console.log('Done!');
} else {
  console.error('Did not get OK result, got', res);
  process.exit(1);
}
