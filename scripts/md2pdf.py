#!/usr/bin/env python3
"""Render one of our markdown documents to a branded PDF.

    python3 scripts/md2pdf.py <input.md> <output.pdf>

Deliberately small: handles the subset of markdown we actually write — headings, bold, italic,
inline code, tables, blockquotes, bullet and numbered lists, horizontal rules. Uses headless
Chrome for the PDF, so there is nothing to install.

Anything after a heading named "Notes for Michael" is dropped, so internal notes never ship.
"""
import re, sys, html, subprocess, os

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
@page { size: letter; margin: 22mm 20mm 20mm; }
body{font:11.5pt/1.62 Georgia,"Iowan Old Style",serif;color:#1d2a3a;margin:0;}
h1{font-size:23pt;line-height:1.16;margin:0 0 4px;color:#14284d;letter-spacing:-.4px;}
h1 + p{font-family:-apple-system,"Helvetica Neue",sans-serif;font-size:10pt;color:#6b7a8f;margin:0 0 26px;}
h2{font-size:15pt;color:#14284d;margin:30px 0 9px;border-top:2px solid #e3ebf4;padding-top:16px;page-break-after:avoid;}
h3{font-size:12pt;color:#1c6fb4;margin:20px 0 6px;font-family:-apple-system,"Helvetica Neue",sans-serif;page-break-after:avoid;}
p{margin:0 0 12px;}
img{max-width:100%;height:auto;display:block;margin:4px auto 2px;border:1px solid #e3ebf4;border-radius:6px;}
p.figure{text-align:center;margin:18px 0 20px;page-break-inside:avoid;}
p.figure em{display:block;font-size:9.5pt;color:#6b7a8f;margin-top:7px;font-family:-apple-system,sans-serif;}
strong{color:#14284d;}
blockquote{margin:16px 0;padding:13px 20px;background:#f4f8fc;border-left:3px solid #1c6fb4;
  font-size:11pt;color:#2c3e55;border-radius:0 8px 8px 0;page-break-inside:avoid;}
table{width:100%;border-collapse:collapse;margin:16px 0;font-size:10.5pt;page-break-inside:avoid;}
th{background:#14284d;color:#fff;text-align:left;padding:9px 12px;
  font-family:-apple-system,sans-serif;font-size:9pt;letter-spacing:.04em;text-transform:uppercase;}
td{padding:9px 12px;border-bottom:1px solid #e3ebf4;vertical-align:top;}
tr:nth-child(even) td{background:#f8fafd;}
ul,ol{margin:0 0 14px;padding-left:22px;} li{margin-bottom:6px;}
hr{border:0;border-top:1px solid #e3ebf4;margin:26px 0;}
code{font:10pt ui-monospace,Menlo,monospace;background:#eef3f9;padding:1px 5px;border-radius:4px;color:#14284d;}
"""

NUM = re.compile(r'^\d+\.\s')
BUL = re.compile(r'^\s*[-*]\s+')
BLOCK = re.compile(r'^(#{1,4}\s|>|\||---|\s*[-*]\s|\d+\.\s)')


def inline(s):
    s = html.escape(s)
    # ![alt](path) — resolved relative to the markdown file, so the PDF can embed it
    s = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', r'<img src="\2" alt="\1">', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', s)
    s = re.sub(r'`([^`]+)`', r'<code>\1</code>', s)
    return s


def convert(src, base=''):
    src = re.split(r'^#{1,4}\s+Notes for Michael', src, flags=re.M)[0].rstrip().rstrip('-').rstrip()
    out, i = [], 0
    lines = src.split('\n')
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1; continue
        if ln.startswith('> **Note on this draft'):          # internal draft note
            while i < len(lines) and lines[i].startswith('>'):
                i += 1
            continue
        m = re.match(r'^(#{1,4})\s+(.*)', ln)
        if m:
            lvl = len(m.group(1))
            out.append('<h%d>%s</h%d>' % (lvl, inline(m.group(2)), lvl)); i += 1; continue
        if ln.startswith('---'):
            out.append('<hr>'); i += 1; continue
        if ln.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip('|').split('|')]); i += 1
            body = [r for r in rows if not all(set(c) <= set('-: ') for c in r)]
            head, rest = body[0], body[1:]
            t = '<table><thead><tr>' + ''.join('<th>%s</th>' % inline(c) for c in head) + '</tr></thead><tbody>'
            for r in rest:
                t += '<tr>' + ''.join('<td>%s</td>' % inline(c) for c in r) + '</tr>'
            out.append(t + '</tbody></table>'); continue
        if ln.startswith('>'):
            q = []
            while i < len(lines) and lines[i].startswith('>'):
                q.append(lines[i].lstrip('> ').rstrip()); i += 1
            out.append('<blockquote>' + inline(' '.join(q)) + '</blockquote>'); continue
        if BUL.match(ln):
            items = []
            while i < len(lines) and BUL.match(lines[i]):
                item = BUL.sub('', lines[i]); i += 1
                while i < len(lines) and re.match(r'^\s{2,}\S', lines[i]) and not BUL.match(lines[i]):
                    item += ' ' + lines[i].strip(); i += 1
                items.append('<li>%s</li>' % inline(item))
            out.append('<ul>' + ''.join(items) + '</ul>'); continue
        if NUM.match(ln):
            items = []
            while i < len(lines) and NUM.match(lines[i]):
                items.append('<li>%s</li>' % inline(NUM.sub('', lines[i]))); i += 1
            out.append('<ol>' + ''.join(items) + '</ol>'); continue
        para = []
        while i < len(lines) and lines[i].strip() and not BLOCK.match(lines[i]):
            para.append(lines[i].strip()); i += 1
        if para:
            joined = inline(' '.join(para))
            cls = ' class="figure"' if joined.strip().startswith('<img') else ''
            out.append('<p%s>%s</p>' % (cls, joined))
    body = '\n'.join(out)
    if base:
        body = re.sub(r'<img src="(?!https?:|file:|data:)([^"]+)"',
                      lambda m: '<img src="file://%s"' % os.path.abspath(os.path.join(base, m.group(1))),
                      body)
    return '<!doctype html><meta charset="utf-8"><style>%s</style>%s' % (CSS, body)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('usage: md2pdf.py <input.md> <output.pdf>')
    src_path, pdf_path = sys.argv[1], os.path.abspath(sys.argv[2])
    tmp = '/tmp/md2pdf.html'
    open(tmp, 'w', encoding='utf-8').write(
        convert(open(src_path, encoding='utf-8').read(), os.path.dirname(os.path.abspath(src_path))))
    subprocess.run([CHROME, '--headless', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files',
                    '--print-to-pdf=' + pdf_path, tmp],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    size = os.path.getsize(pdf_path)
    pages = re.search(rb'/Count\s+(\d+)', open(pdf_path, 'rb').read())
    print('  %s  %.0f KB  %s pages' % (pdf_path, size / 1024,
                                       pages.group(1).decode() if pages else '?'))
