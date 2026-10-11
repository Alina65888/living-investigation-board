"""Restore the anonymous service layout prepared from the supplied 18.06.2025 sample.

The original source was NPD: its variable preamble, tax wording and requisites
were already parameterised in the pinned revision. The business variant uses
IP/organisation requisites, never NPD conditions. It is not a verbatim copy of
the unavailable Baylyk 04-26/2 service contract.
"""
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
import subprocess
from lxml import etree as E

REVISION = '70a6396'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

def build():
    repo = Path(__file__).resolve().parents[1]
    source = subprocess.check_output(['git', 'show', REVISION + ':docs/templates/services.docx'], cwd=repo)
    with ZipFile(BytesIO(source)) as archive:
        files = {n: archive.read(n) for n in archive.namelist()}
    root = E.fromstring(files['word/document.xml'])
    # Business signatures have the same stamp position on both sides.
    # Copy only the existing customer's stamp paragraph, retaining its styling.
    from copy import deepcopy
    for table in root.findall('.//w:tbl', NS):
        rows = table.findall('w:tr', NS)
        if len(rows) != 1:
            continue
        cells = rows[0].findall('w:tc', NS)
        if len(cells) != 2:
            continue
        for paragraph in cells[0].findall('w:p', NS):
            if '{{customerStamp}}' in ''.join(paragraph.xpath('.//w:t/text()', namespaces=NS)):
                stamp = deepcopy(paragraph)
                for text in stamp.findall('.//w:t', NS):
                    text.text = (text.text or '').replace('{{customerStamp}}', '{{executorStamp}}')
                cells[1].append(stamp)
    # Remove trailing empty paragraphs inherited from the source: with a longer
    # specification they otherwise create an entirely blank last page.
    body = root.find('w:body', NS)
    trailing = list(body)
    if trailing and trailing[-1].tag == E.QName(NS['w'], 'sectPr'):
        trailing.pop()
    while trailing and trailing[-1].tag == E.QName(NS['w'], 'p'):
        paragraph = trailing[-1]
        if paragraph.xpath('.//w:t[string-length(.) > 0] | .//w:drawing | .//w:br | .//w:sectPr', namespaces=NS):
            break
        body.remove(trailing.pop())
    # Keep a minimal final paragraph after the table for Word compatibility.
    paragraph = E.Element(E.QName(NS['w'], 'p'))
    props = E.SubElement(paragraph, E.QName(NS['w'], 'pPr'))
    spacing = E.SubElement(props, E.QName(NS['w'], 'spacing'))
    for key, value in {'before':'0', 'after':'0', 'line':'20', 'lineRule':'exact'}.items():
        spacing.set(E.QName(NS['w'], key), value)
    run_props = E.SubElement(props, E.QName(NS['w'], 'rPr'))
    E.SubElement(run_props, E.QName(NS['w'], 'sz')).set(E.QName(NS['w'], 'val'), '2')
    body.insert(len(body) - 1, paragraph)
    text = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    assert not any(term.encode() in text for term in ['НПД', 'профессиональный доход', 'Гражданин', 'Гражданка', 'Паспорт'])
    files['word/document.xml'] = text
    with ZipFile(repo / 'docs/templates/services-business.docx', 'w', ZIP_STORED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)

if __name__ == '__main__':
    build()
