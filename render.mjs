// ended up not using this
// kept the file in case I change my mind
// you will need to `npm install --no-save pdfjs-dist canvas` for this to work
// then `node render.mjs path-to-input-pdf path-to-output-png`

// code derived from https://github.com/mozilla/pdf.js/blob/9640add1f76c8ae379862baf6d3dc828c5906df9/examples/node/pdf2png/pdf2png.js
// under the Apache license

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import Canvas from 'canvas';
import pdfjsLib from 'pdfjs-dist';

class NodeCanvasFactory {
  create(width, height) {
    assert(width > 0 && height > 0, 'Invalid canvas size');
    const canvas = Canvas.createCanvas(width, height);
    const context = canvas.getContext('2d');
    return {
      canvas,
      context,
    };
  }

  reset(canvasAndContext, width, height) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');
    assert(width > 0 && height > 0, 'Invalid canvas size');
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    assert(canvasAndContext.canvas, 'Canvas is not specified');

    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

async function getPngBuffer(data) {

  // Some PDFs need external cmaps.
  const CMAP_URL = './node_modules/pdfjs-dist/cmaps/';
  const CMAP_PACKED = true;

  // Where the standard fonts are located.
  const STANDARD_FONT_DATA_URL = './node_modules/pdfjs-dist/standard_fonts/';

  // Load the PDF file.
  const loadingTask = pdfjsLib.getDocument({
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: CMAP_PACKED,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  });

  const pdfDocument = await loadingTask.promise;
  console.log('# PDF document loaded.');
  // Get the first page.
  const page = await pdfDocument.getPage(1);
  // Render the page on a Node canvas with 100% scale.
  const viewport = page.getViewport({ scale: 2.0 });
  const canvasFactory = new NodeCanvasFactory();
  const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
  const renderContext = {
    canvasContext: canvasAndContext.context,
    viewport,
    canvasFactory,
  };

  const renderTask = page.render(renderContext);
  await renderTask.promise;
  // Convert the canvas to an image buffer.
  const image = canvasAndContext.canvas.toBuffer();
  // Release page resources.
  page.cleanup();
  return image;
}

const pdfPath = process.argv[2];
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node render.mjs path-to-paycheck.pdf output-filename.png');
    process.exit(0);
  }
  let path = process.argv[2];
  let outPath = process.argv[3];
  if (!fs.existsSync(path)) {
    console.error(`can't find ${path}`);
    process.exit(1);
  }
  // Loading file from file system into typed array.
  const input = new Uint8Array(fs.readFileSync(path));
  const png = await getPngBuffer(input);
  fs.writeFileSync(outPath, png);
}
