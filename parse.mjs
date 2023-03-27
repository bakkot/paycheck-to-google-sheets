import fs from 'fs';
import { pathToFileURL } from 'url';
import PDFParser from 'pdf2json';

const PAGE_WIDTH_PER_LETTER = 1 / 123.96; // this number was determined empirically
const EPSILON = .000001;

function parsePDF(path) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataError', errData => reject(errData.parserError));
    pdfParser.on('pdfParser_dataReady', resolve);
    // the pdf2json doesn't let you set verbosity except by calling this method, gross
    pdfParser.loadPDF(path);
  });
}

// TODO the language should do this.
function sum(iter) {
  let tot = 0;
  for (let item of iter) {
    tot += item;
  }
  return tot;
}

function parseCurrency(str) {
  if (!/[0-9]{1,3}(,[0-9]{3})*\.[0-9][0-9]$/.test(str)) {
    throw new Error(`failed to parse amount ${str}`);
  }
  return parseInt(str.replace(/[,.]/g, ''));
}

function extractTextFor(pdfData) {
  let { Texts: texts, Width: width, Height: height } = pdfData.Pages[0];
  // console.log(pdfData.Pages[0].VLines.map(v => ({ x: v.x / width, y: v.y / height, l: v.l / height })));
  // console.log(pdfData.Pages[0].Texts)
  for (let item of texts) {
    if (item.R.length !== 1) {
      throw new Error('expected text length 1, got' + item.R.length);
    }
    if (item.A !== 'left') {
      throw new Error('expected left-aligned');
    }
    if (item.R[0].TS[0] !== 3) {
      throw new Error('expected font id 3 "QuickType Mono,Courier New,Courier,monospace"');
    }
    if (item.R[0].TS[1] !== 11) {
      throw new Error('expected font size 11 pt');
    }
    if (item.R[0].S !== -1) {
      throw new Error('expected no style');
    }
  }
  let xyt = texts.map(item => {
    let text = decodeURIComponent(item.R[0].T);
    let initialSpaces = text.match(/^ */)[0].length;
    text = text.trim(); // we don't care about RHS spaces
    return { x: (item.x / width) + initialSpaces * PAGE_WIDTH_PER_LETTER, y: item.y / height, text };
  });
  let lineMap = new Map;
  lineMap.get = x => ((lineMap.has(x) ? null : lineMap.set(x, [])), Map.prototype.get.call(lineMap, x));
  for (let item of xyt) {
    lineMap.get(item.y).push(item);
  }
  let zeroPoint = Math.min(...xyt.map(item => item.x));
  let maxPoint = Math.max(...xyt.map(item => item.x + item.text.length * PAGE_WIDTH_PER_LETTER));
  function spacesFor(width) {
    if (width < -EPSILON) {
      throw new Error('text overlap: ' + width);
    }
    let inUnitsOfChars = width / PAGE_WIDTH_PER_LETTER;
    if (Math.abs(Math.round(inUnitsOfChars) - inUnitsOfChars) > EPSILON) {
      throw new Error('not aligned ' + inUnitsOfChars);
    }
    return Math.round(inUnitsOfChars);
  }
  let lines = [...lineMap.values()]
    .map(line => {
      line.sort((a, b) => a.x - b.x);
      let text = '';
      let ptr = zeroPoint;
      for (let item of line) {
        text += ' '.repeat(spacesFor(item.x - ptr)) + item.text;
        ptr = item.x + item.text.length * PAGE_WIDTH_PER_LETTER;
      }
      text += ' '.repeat(spacesFor(maxPoint - ptr));
      return text;
    });
  return lines;
}

function extractDataFor(lines) {
  // we're just gonna hardcode a bunch of stuff
  let end = lines.findIndex(l => l === '_'.repeat(120));
  if (end === '-1') throw new Error('could not find divider');
  lines = lines.slice(0, end);
  let firstHalf = [];
  let secondHalf = [];
  for (let line of lines) {
    firstHalf.push(line.slice(0, 60));
    secondHalf.push(line.slice(60));
  }

  let headerIdx = firstHalf.findIndex(l => / Earnings +Rate +Hours\/Units +Amount +Year-To-Date *$/g.test(l));
  if (headerIdx === -1) throw new Error('could not find header');
  let header = firstHalf[headerIdx];
  firstHalf = firstHalf.slice(headerIdx + 1);
  let amountCol = header.indexOf('Amount') + 'Amount'.length - 1;
  let ytdCol = header.indexOf('Year-To-Date') + 'Year-To-Date'.length - 1;
  let results = {
    inputs: { __proto__: null },
    deductions: { __proto__: null },
    deposits: [],
    gross: null,
    net: null,
  };
  let cat = '';
  for (let line of firstHalf) {
    if (!(/[0-9]/.test(line[amountCol]) && [' ', '-'].includes(line[amountCol + 1]) && [' ', void 0].includes(line[amountCol + 2]))) {
      if (line[0] === ' ' && line[1] !== ' ' && /\w/.test(line)) {
        cat = line.trim();
      }
      continue;
    }
    let i = amountCol;
    while (/[0-9,.]/.test(line[i])) {
      --i;
    }
    if (line[i] !== ' ') {
      throw new Error('expected space before amount');
    }
    let amount = parseCurrency(line.slice(i + 1, amountCol + 1));
    let neg = line[amountCol + 1] === '-';
    let kindM = line.match(/^ *([*\-,.\w]+ )+/);
    if (kindM == null) {
      throw new Error(`failed to parse line kind: ${JSON.stringify(line)}`);
    }
    let kind = kindM[0].trim();
    if (kindM[0].startsWith('  ')) {
      kind = `${cat} - ${kind}`;
    }
    if (kind === 'Gross Pay') {
      if (results.gross != null) {
        throw new Error('multiple gross pay lines');
      }
      results.gross = amount;
    } else if (kind === 'Total Net Pay') {
      if (results.net != null) {
        throw new Error('multiple net pay lines');
      }
      results.net = amount;
    } else {
      if (results.gross == null && neg) {
        throw new Error(`unexpected negative quantity in gross pay: ${line}`);
      } else if (results.gross != null && !neg) {
        // since these are deductions, the normal meaning of "negative" is inverted
        amount = -amount;
      }
      let which = results.gross == null
        ? results.inputs
        : results.deductions;
      if (which[kind] != null) {
        throw new Error(`multiple instances of ${kind}`);
      }
      which[kind] = amount;
    }
    // console.log(kind[0].trim(), amount, neg);
  }
  if (results.gross == null) {
    throw new Error('no gross pay line');
  }
  if (results.net == null) {
    throw new Error('no net pay line');
  }
  if (sum(Object.values(results.inputs)) !== results.gross) {
    throw new Error(`inputs (${sum(Object.values(results.inputs))}) do not sum to gross (${results.gross})`);
  }
  if (results.gross - sum(Object.values(results.deductions)) !== results.net) {
    throw new Error(`gross (${results.gross}) - deductions (${sum(Object.values(results.deductions))}) ≠ net (${results.net})`);
  }

  // now figure out where it went

  let dds = secondHalf
    .map(l => l.match(/^ *Direct Deposit *([0-9.,]+) *$/))
    .filter(l => l != null)
    .map(l => parseCurrency(l[1]));
  if (sum(dds) !== results.net) {
    throw new Error(`direct deposits (${sum(dds)}) ≠ net pay (${results.net})`);
  }
  results.deposits = dds;
  return results;
}

export async function readAndParse(path) {
  let pdfData = await parsePDF(path);
  let lines = extractTextFor(pdfData);
  // console.log(lines);
  let results = extractDataFor(lines);
  return results;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let path = process.argv[2];
  if (process.argv.length !== 3) {
    console.error('Usage: node parse.mjs path-to-paycheck.pdf');
    process.exit(0);
  }
  if (!fs.existsSync(path)) {
    console.error(`can't find ${path}`);
    process.exit(1);
  }
  console.log(await readAndParse(path));
}
