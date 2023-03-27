# Paychecks to Google Sheets

Automates uploading information from paycheck PDFs into a Google Sheet, because I got annoyed doing it by hand.

Not really generalizable because it hardcodes the precise layout of the paychecks I'm working with. Might serve as a starting point for you, though.

## Setup

### Node

Install node, then

```
npm install
```

### Google Cloud project

Create a Google Cloud project, enable the Speech-To-Text API for that project, and set up OAuth following [the quickstart guide for Node](https://developers.google.com/sheets/api/quickstart/nodejs). Save the resulting credential file as `google-cloud-creds.json` in this directory.

### Spreadsheet data

Find the ID of the spreadsheet to add data to. You may want to start with a scratch sheet in case it damages something.
This is the `1hPlpOA8lh-lyDEeGZFMMtyO5wyJ6No-ZHcI11sdCo2Y` part of doc's URL, as in `https://docs.google.com/spreadsheets/d/1hPlpOA8lh-lyDEeGZFMMtyO5wyJ6No-ZHcI11sdCo2Y/`.

You'll also need to define mappings from the names of rows in the PDF to spreadsheet columns, as well as specifying columns for the date, the net, and the gross. The columns for `net` and `gross` can be `null` if you don't care to include one of them.

Put all that info into a JSON file named `spreadsheet-data.json` that looks like this:

```json
{
  "id": "1hPlpOA8lh-lyDEeGZFMMtyO5wyJ6No-ZHcI11sdCo2Y",
  "columns": {
    "net": null,
    "date": "A",
    "gross": "B",
    "Tax Deductions: Federal - Withholding Tax": "C",
    "Tax Deductions: Federal - EE Social Security Tax": "D",
    "Additional Deductions - Stock Purch EE After-tax": "E",
    "Additional Deductions - RESPP": "M",
    "deposits-1": "Q",
    "deposits-2": "R"
  }
}
```

Don't worry about getting the PDF row names right to start; it will complain (and tell you the unknown name) if you try to run it against a PDF which specifies a row which isn't in your json file.

## Use

Once all that's done, run

```
node upload.mjs path-to-paychecks-dir
```

The first time you do this it will pop up a browser window asking you to authenticate. You'll need to re-auth periodically; if you get an error about `invalid_grant`; delete the `google-cloud-token.json` file and try again.

If that worked, it will parse all the data from the PDFs and update the spreadsheet, one row per PDF. It does the updating all in one shot after parsing all the data, so if anything goes wrong before that point it won't touch the spreadsheet at all. Don't touch the spreadsheet while it's running.

BE ADVISED that it will skip any dates which are already present, which is useful because you can just re-run it whenever you add new PDFs, but which may cause problems if you have multiple paychecks from the same date.

### Starting with a specific date

If you need to skip earlier paychecks (e.g. because the format changed), you can pass an optional fourth parameter for the first date to look at, as in `2022` or `2022-03-01`.

### Rendering

I didn't end up going this route, but the file `render.mjs` will render the first page of a PDF to a PNG:

```
npm install --no-save pdfjs-dist canvas
node render.mjs path-to-input-pdf path-to-output-png
```
