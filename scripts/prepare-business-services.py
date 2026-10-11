"""Build business services from the supplied Baylyk 04-26/2 PDF (28.04.2026).

Its typography, sections, requisites and six-column specification match the
previously supplied Baylyk supply Word package. Reuse that anonymous layout,
then apply the service wording verified against all three PDF pages.
No private source document or sample requisites are embedded in the output.
"""
from pathlib import Path
import importlib.util
from lxml import etree as E

spec = importlib.util.spec_from_file_location('office', Path(__file__).with_name('prepare-document-templates.py'))
office = importlib.util.module_from_spec(spec)
spec.loader.exec_module(office)


def build():
    files = office.load(office.OUT / 'supply-org.docx')
    root = E.fromstring(files['word/document.xml'])
    body = list(root.find('w:body', office.NS))
    assert len(body) == 59, 'Unexpected source layout'
    office.put(body[13], '2.2.1. надлежащим образом оказать услуги надлежащего качества, перечисленные в п. 1.1. Договора и в Спецификации, являющихся неотъемлемой частью Договора;')
    # Correct the leftover supply wording in the service sample.
    office.put(body[19], '2.5.1. во всякое время проверять качество оказания Услуг, оказываемых {{executorInstrumental}}, не вмешиваясь в его деятельность.')
    office.token(body[23], 'paymentClause')
    office.put(body[53], 'Порядок расчетов: оплата производится Заказчиком путем перечисления денежных средств на расчетный счет Исполнителя в размере 100% оплаты.')
    office.token(body[55], 'businessServiceDeadline')
    # Google Docs' PDF resolves shared borders as black. Make this explicit so
    # Word/LibreOffice cannot select a neighbour's inherited grey/white edge.
    for border in body[52].xpath('.//w:tcBorders/* | ./w:tblPr/w:tblBorders/*', namespaces=office.NS):
        for key, value in {'color':'000000', 'val':'single', 'sz':'6'}.items():
            border.set(E.QName(office.W, key), value)
    for i, row in enumerate(office.rows(body[52])):
        props = row.find('w:trPr', office.NS)
        if props is None:
            props = E.Element(E.QName(office.W, 'trPr')); row.insert(0, props)
        for old in props.findall('w:cantSplit', office.NS) + props.findall('w:tblHeader', office.NS):
            props.remove(old)
        E.SubElement(props, E.QName(office.W, 'cantSplit'))
        if i == 0:
            E.SubElement(props, E.QName(office.W, 'tblHeader'))
        elif i < len(office.rows(body[52])) - 1:
            # Fit two-digit item suffixes without changing column widths/font.
            for margin in office.cells(row)[0].xpath('./w:tcPr/w:tcMar/w:left | ./w:tcPr/w:tcMar/w:right', namespaces=office.NS):
                margin.set(E.QName(office.W, 'w'), '40')
    # The PDF combines each name and description into one paragraph.
    for row in office.rows(body[52])[1:-1]:
        cell = office.cells(row)[1]
        paragraphs = office.paras(cell)
        office.token(paragraphs[0], 'itemInlineDescription')
        for paragraph in paragraphs[1:]:
            cell.remove(paragraph)
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    # The PDF explicitly uses Times New Roman 12 pt. The imported Word layout
    # omits its default font, so declare it instead of relying on Office defaults.
    styles = E.fromstring(files['word/styles.xml'])
    defaults = styles.find('w:docDefaults/w:rPrDefault/w:rPr', office.NS)
    fonts = defaults.find('w:rFonts', office.NS)
    if fonts is None:
        fonts = E.Element(E.QName(office.W, 'rFonts')); defaults.insert(0, fonts)
    for key in ['ascii', 'hAnsi', 'eastAsia', 'cs']:
        fonts.set(E.QName(office.W, key), 'Times New Roman')
    files['word/styles.xml'] = E.tostring(styles, xml_declaration=True, encoding='UTF-8', standalone=True)
    text = office.txt(root)
    assert not any(term in text for term in ['Покупател', 'Поставщик', 'Товар', 'НПД', 'профессиональный доход', 'Гражданка', 'Паспорт'])
    office.save('services-business.docx', files)


if __name__ == '__main__':
    build()
