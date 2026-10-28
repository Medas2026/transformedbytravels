#!/usr/bin/env python3
"""Read the comments and highlights out of a marked-up PDF.

    python3 scripts/read-pdf-notes.py "Stawi Summary v2.pdf"

Mark the PDF up in Preview (Tools > Annotate), save it, then run this. It pulls out sticky
notes, highlights, strikethroughs and text boxes so the edits can go back into the markdown
source, which is the thing that actually matters — the PDF is regenerated output.

Pure standard library; nothing to install.
"""
import re, sys, zlib

TYPES = {'Text': 'note', 'Highlight': 'highlight', 'StrikeOut': 'strikeout',
         'Underline': 'underline', 'Squiggly': 'squiggly', 'FreeText': 'textbox',
         'Popup': None, 'Link': None}


def unescape(b):
    b = re.sub(rb'\\([()\\])', rb'\1', b)
    b = re.sub(rb'\\(\d{1,3})', lambda m: bytes([int(m.group(1), 8) & 0xFF]), b)
    return b


def decode(b):
    if b[:2] in (b'\xfe\xff',):                      # UTF-16BE with BOM
        return b[2:].decode('utf-16-be', 'replace')
    return b.decode('latin-1', 'replace')


def main(path):
    raw = open(path, 'rb').read()
    # Object streams may be compressed; decompress what we can and search both.
    blobs = [raw]
    for m in re.finditer(rb'stream\r?\n(.*?)\r?\nendstream', raw, re.S):
        try:
            blobs.append(zlib.decompress(m.group(1)))
        except Exception:
            pass

    found, seen = [], set()
    for blob in blobs:
        for m in re.finditer(rb'/Subtype\s*/(\w+)(.{0,1200}?)(?:/Subtype|endobj)', blob, re.S):
            kind = TYPES.get(m.group(1).decode('latin-1', 'replace'), '?')
            if not kind or kind == '?':
                continue
            body = m.group(2)
            c = re.search(rb'/Contents\s*\((.*?)(?<!\\)\)', body, re.S)
            text = decode(unescape(c.group(1))).strip() if c else ''
            pg = re.search(rb'/Page\s+(\d+)', body)
            key = (kind, text)
            if text and key not in seen:
                seen.add(key)
                found.append((kind, text, pg.group(1).decode() if pg else '?'))

    if not found:
        print('\n  No comments found in this PDF.\n')
        print('  If you did annotate it: make sure you saved (Cmd+S) after marking up, and that')
        print('  highlights have a note attached — a bare yellow highlight carries no text, so')
        print('  there is nothing for this to read. Double-click a highlight to add a note.\n')
        return

    print(f'\n  {len(found)} comment(s) in {path}\n')
    for kind, text, page in found:
        print(f'  [{kind}] p{page}')
        for line in text.splitlines():
            print(f'      {line}')
        print()


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'Stawi Summary v2.pdf')
