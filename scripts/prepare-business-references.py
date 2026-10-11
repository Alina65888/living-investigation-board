"""Parameterize the four approved September 2026 Word references.

Usage: prepare-business-references.py SUPPLY_IP.docx SERVICES_ORG.docx
                                    INVOICE_IP.docx INVOICE_ORG.docx
Private source files stay outside git. Preserve their Office style packages;
remove sample signatures/seals and replace all transaction data with fields.
"""
from pathlib import Path
import importlib.util
import sys
from lxml import etree as E

spec = importlib.util.spec_from_file_location('approved', Path(__file__).with_name('prepare-approved-contract.py'))
approved = importlib.util.module_from_spec(spec)
spec.loader.exec_module(approved)
office = approved.office
NS, W = office.NS, office.W


def serialize(root):
    return E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)


def remove_sample_images(files):
    # The only source images are the completed sample's seal and signature.
    for name in list(files):
        if name.startswith('word/media/'):
            del files[name]
        elif name.endswith('.xml') or name.endswith('.rels'):
            root = E.fromstring(files[name])
            changed = False
            for node in root.xpath('//w:drawing[.//*[local-name()="blip"]] | //w:pict[.//*[local-name()="imagedata"]]', namespaces=NS):
                node.getparent().remove(node); changed = True
            for node in list(root):
                if node.get('Type', '').endswith('/image') or node.get('PartName', '').startswith('/word/media/'):
                    root.remove(node); changed = True
            if changed:
                files[name] = serialize(root)
    return files


def property(node, parent, name, value='1'):
    props = node.find('w:' + parent, NS)
    if props is None:
        props = E.Element(E.QName(W, parent)); node.insert(0, props)
    prop = props.find('w:' + name, NS)
    if prop is None:
        prop = E.SubElement(props, E.QName(W, name))
    prop.set(E.QName(W, 'val'), value)


def contract(source, name):
    files = remove_sample_images(office.load(source))
    root = E.fromstring(files['word/document.xml'])
    body = list(root.find('w:body', NS))
    supply = name == 'supply-ip'
    assert len(body) == (61 if supply else 59), 'Unexpected reference structure'
    date, executor, customer, subject, price, req, table, signature = (2, 3, 4, 8, 22, 43, 53, 58) if supply else (3, 5, 6, 10, 24, 45, 52, 56)
    office.token(body[1], 'contractTitle')
    for cell, key in zip(office.cells(office.rows(body[date])[0]), ['city', 'date']):
        office.token(cell, key)
    office.preamble(body[executor], 'executor'); office.preamble(body[customer], 'customer')
    p = body[subject]; text = office.txt(p)
    variable = text.split(': ', 1)[1].split(', а ')[0]
    approved.replace(p, variable, '{{businessSubject}}')
    if supply:
        # The supply sample has a leftover service noun in its acceptance clause.
        approved.replace(p, 'данную услугу', 'Товар')
    p = body[price]; text = office.txt(p)
    amount = text.split('составляет: ')[1].split(' НДС')[0]
    approved.replace(p, amount, '{{amountWithWords}}')
    approved.replace(p, 'НДС не облагается.', '{{vatLine}}')
    office.requisites(body[req], False)
    for cell, side in zip(office.cells(office.rows(body[req])[0]), ['customer', 'executor']):
        paragraphs = [p for p in office.paras(cell) if office.txt(p).strip()]
        office.token(paragraphs[1], side + 'BusinessTitle')
        for p in paragraphs[2:]: office.put(p, '')
    if supply:
        office.token(body[48], 'appendixContract')
        office.token(body[49], 'businessAppendixReference')
    else:
        # The source places the contract number and date on separate lines.
        ts = body[48].findall('.//w:t', NS)
        assert body[48].find('.//w:br', NS) is not None and len(ts) == 5
        ts[1].text = ' {{contractNumber}}'; ts[-1].text = '{{contractDateYear}}'
        # Keep the appendix heading with its table, instead of orphaning it at
        # the bottom of the requisites page as in the completed source.
        property(body[47], 'pPr', 'pageBreakBefore')
    for p in body[47:table]: property(p, 'pPr', 'keepNext')
    rs = office.rows(body[table])
    assert len(rs) == 4 and len(office.cells(rs[1])) == 2
    office.token(office.cells(rs[1])[1], 'itemGroup')
    office.repeat(body[table], 2, 3, ['itemNumber', 'itemFullName', 'itemUnit', 'itemQuantity', 'itemPrice', 'itemTotal'])
    if not supply:
        # The service description is separated by a line break in one paragraph,
        # while the IP source uses two paragraphs. Retain each reference's form.
        ps = office.paras(office.cells(rs[2])[1]); assert len(ps) == 1
        ts = ps[0].findall('.//w:t', NS)
        assert len(ts) == 2 and ps[0].find('.//w:br', NS) is not None
        ts[0].text = '{{itemName}}'; ts[1].text = '{{itemDescription}}'
    office.token(office.cells(rs[-1])[-2], 'totalLabel'); office.token(office.cells(rs[-1])[-1], 'total')
    property(rs[0], 'trPr', 'tblHeader')
    # Allow a long description to wrap across pages, never clip a fixed row.
    for row in rs:
        for height in row.xpath('./w:trPr/w:trHeight', namespaces=NS):
            height.set(E.QName(W, 'hRule'), 'atLeast')
    office.token(body[table + 2], 'appendixTotal')
    office.token(body[table + 3], 'businessDeadline')
    office.signature(office.rows(body[signature])[0])
    files['word/document.xml'] = serialize(root)
    check_anonymous(files)
    office.save(name + '.docx', files)


def check_anonymous(files):
    assert not any(n.startswith(('word/media/', 'docProps/', 'word/comments', 'word/people')) for n in files)
    text = ''.join(office.txt(E.fromstring(v)) for n, v in files.items() if n.endswith('.xml'))
    assert not any(s in text for s in ['Шейлан', 'Байлык', 'Габдуллин', 'Шаталов', '1655259704', '190 000', '15 000', '@'])
    import re
    assert not re.search(r'\b\d{12,20}\b', text), 'Sample requisites left in template'


def invoice(source, name):
    files = remove_sample_images(office.load(source))
    original = E.fromstring(files['word/document.xml'])
    borders = [dict(n.attrib) for n in original.xpath('//w:tcBorders/*', namespaces=NS)]
    # Unlike the older invoice, these references have UNIT before QUANTITY.
    files = office.prepare_invoice(files)
    root = E.fromstring(files['word/document.xml'])
    # The September Word files already contain the intended border styling.
    # Undo the legacy PDF compatibility normalization performed by the helper.
    for node, attributes in zip(root.xpath('//w:tcBorders/*', namespaces=NS), borders):
        node.attrib.clear(); node.attrib.update(attributes)
    body = list(root.find('w:body', NS))
    row = office.rows(body[4])[1]
    office.token(office.cells(row)[2], 'itemUnit')
    office.token(office.cells(row)[3], 'itemQuantity')
    property(office.rows(body[4])[0], 'trPr', 'tblHeader')
    files['word/document.xml'] = serialize(root)
    check_anonymous(files)
    office.save(name + '.docx', files)


if __name__ == '__main__':
    contract(Path(sys.argv[1]), 'supply-ip')
    contract(Path(sys.argv[2]), 'services-business')
    invoice(Path(sys.argv[3]), 'invoice-ip')
    invoice(Path(sys.argv[4]), 'invoice-org')
