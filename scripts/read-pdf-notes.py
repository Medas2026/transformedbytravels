#!/usr/bin/env python3
"""Read the comments and highlights out of a marked-up PDF, with page numbers.

    python3 scripts/read-pdf-notes.py "Stawi Summary v5.pdf"

Mark the PDF up in Preview (Tools > Annotate), save it with Cmd+S, then run this. It reports
sticky notes, highlights, strikethroughs and text boxes in page order, with the page each one
sits on, so an edit can be found without guessing.

Pure standard library; nothing to install.

Note on highlights: a bare yellow highlight carries no text. Double-click it and type a note,
or there is nothing here to read.
"""
import re, sys

TYPES = {'Text': 'note', 'Highlight': 'highlight', 'StrikeOut': 'strikeout',
         'Underline': 'underline', 'Squiggly': 'squiggly', 'FreeText': 'textbox',
         'Caret': 'insert', 'Popup': None, 'Link': None, 'Widget': None}


def unescape(b):
    b = re.sub(rb'\\([()\\])', rb'\1', b)
    return re.sub(rb'\\(\d{1,3})', lambda m: bytes([int(m.group(1), 8) & 0xFF]), b)


def decode(b):
    if b[:2] == b'\xfe\xff':
        return b[2:].decode('utf-16-be', 'replace')
    return b.decode('latin-1', 'replace')


def objects(raw):
    """Every `N 0 obj … endobj` in the file, keyed by object number."""
    out = {}
    for m in re.finditer(rb'(\d+)\s+\d+\s+obj\b(.*?)\bendobj', raw, re.S):
        out[int(m.group(1))] = m.group(2)
    return out


def refs_in(blob, objs, depth=0):
    """Object numbers in an /Annots value, following one indirect reference if needed."""
    if depth > 2:
        return []
    blob = blob.strip()
    m = re.match(rb'(\d+)\s+\d+\s+R\s*$', blob)
    if m:                                        # /Annots 431 0 R  →  resolve it
        return refs_in(objs.get(int(m.group(1)), b''), objs, depth + 1)
    return [int(n) for n in re.findall(rb'(\d+)\s+\d+\s+R', blob)]


def main(path):
    raw = open(path, 'rb').read()
    objs = objects(raw)

    # Pages in file order. Good enough: writers emit them in order, and Preview does.
    pages = [n for n, b in sorted(objs.items())
             if re.search(rb'/Type\s*/Page(?![a-zA-Z])', b)]

    found = []
    for i, pnum in enumerate(pages, 1):
        m = re.search(rb'/Annots\s*((?:\[[^\]]*\])|(?:\d+\s+\d+\s+R))', objs[pnum])
        if not m:
            continue
        for a in refs_in(m.group(1), objs):
            blob = objs.get(a, b'')
            st = re.search(rb'/Subtype\s*/(\w+)', blob)
            if not st:
                continue
            kind = TYPES.get(st.group(1).decode('latin-1', 'replace'), '?')
            if not kind or kind == '?':
                continue
            c = re.search(rb'/Contents\s*\((.*?)(?<!\\)\)', blob, re.S)
            text = decode(unescape(c.group(1))).strip() if c else ''
            if text:
                found.append((i, kind, text))

    if not found:
        print('\n  No comments found.\n')
        print('  If you did annotate it: save with Cmd+S first, and make sure highlights have a')
        print('  note attached — a bare highlight carries no text.\n')
        return

    print(f'\n  {len(found)} comment(s) in {path}\n')
    last = None
    for page, kind, text in found:
        if page != last:
            print(f'  \033[1m── page {page} ──\033[0m')
            last = page
        print(f'    [{kind}]')
        for line in text.splitlines():
            print(f'      {line}')
        print()


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'Stawi Summary v4.pdf')
