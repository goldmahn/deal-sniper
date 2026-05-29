const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const mdPath = path.join(root, "docs", "architecture-review-2026-05-28.md");
const pdfPath = path.join(root, "docs", "architecture-review-2026-05-28.pdf");

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function markdownToHtml(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let inCode = false;
  let codeLang = "";
  let inTable = false;
  let tableHeaderDone = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCode) {
        codeLang = line.slice(3).trim();
        out.push(`<pre><code class="language-${escapeHtml(codeLang)}">`);
        inCode = true;
      } else {
        out.push("</code></pre>");
        inCode = false;
      }
      continue;
    }

    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }

    if (line.startsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());

      if (/^[-:\s|]+$/.test(line.replace(/\|/g, ""))) {
        continue;
      }

      if (!inTable) {
        out.push("<table>");
        inTable = true;
        tableHeaderDone = false;
      }

      const tag = tableHeaderDone ? "td" : "th";
      if (!tableHeaderDone) {
        tableHeaderDone = true;
      }

      out.push(
        "<tr>" + cells.map((cell) => `<${tag}>${inlineFormat(cell)}</${tag}>`).join("") + "</tr>"
      );
      continue;
    }

    if (inTable) {
      out.push("</table>");
      inTable = false;
      tableHeaderDone = false;
    }

    if (line.startsWith("# ")) {
      out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
    } else if (line.startsWith("#### ")) {
      out.push(`<h4>${inlineFormat(line.slice(5))}</h4>`);
    } else if (line.trim() === "---") {
      out.push("<hr />");
    } else if (line.trim() === "") {
      out.push("");
    } else if (line.startsWith("- ")) {
      out.push(`<ul><li>${inlineFormat(line.slice(2))}</li></ul>`);
    } else {
      out.push(`<p>${inlineFormat(line)}</p>`);
    }
  }

  if (inTable) {
    out.push("</table>");
  }
  if (inCode) {
    out.push("</code></pre>");
  }

  return out.join("\n");
}

function inlineFormat(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

async function main() {
  const markdown = fs.readFileSync(mdPath, "utf8");
  const body = markdownToHtml(markdown);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Deal Sniper Architecture Review</title>
  <style>
    @page { margin: 0.75in; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #111;
      max-width: 100%;
    }
    h1 { font-size: 22pt; margin-top: 0; page-break-after: avoid; }
    h2 { font-size: 16pt; margin-top: 1.4em; page-break-after: avoid; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
    h3 { font-size: 13pt; margin-top: 1.2em; page-break-after: avoid; }
    h4 { font-size: 11.5pt; margin-top: 1em; page-break-after: avoid; }
    p, li { orphans: 3; widows: 3; }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 9pt;
    }
    pre {
      background: #f6f8fa;
      border: 1px solid #e1e4e8;
      border-radius: 4px;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
      page-break-inside: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
      margin: 0.8em 0;
      page-break-inside: avoid;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f0f0f0; }
    hr { border: 0; border-top: 1px solid #ddd; margin: 1.5em 0; }
    ul { margin: 0.4em 0 0.8em 0; padding-left: 1.2em; }
  </style>
</head>
<body>
${body}
</body>
</html>`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    margin: { top: "0.75in", right: "0.75in", bottom: "0.75in", left: "0.75in" },
  });
  await browser.close();

  console.log(`Wrote ${pdfPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
