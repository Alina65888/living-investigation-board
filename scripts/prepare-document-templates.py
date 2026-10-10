"""Prepare anonymous, layout-preserving templates from the approved Office samples.

Usage: python prepare-document-templates.py INPUT_DIRECTORY
The input documents are private and must never be committed. Output contains only
placeholders, generic document wording, original styles and embedded fonts.
"""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
from lxml import etree as E
import sys

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}
OUT = Path(__file__).resolve().parents[1] / 'docs/templates'

def txt(n):
    return ''.join(n.xpath('.//w:t/text()', namespaces=NS))

def put(n, value):
    """Change text only: paragraph/run/cell properties remain from the source."""
    ts = n.findall('.//w:t', NS)
    if not ts:
        p = n if n.tag == f'{{{W}}}p' else n.find('.//w:p', NS)
        if p is None:
            raise ValueError('No paragraph for ' + value)
        r = E.SubElement(p, f'{{{W}}}r')
        ts = [E.SubElement(r, f'{{{W}}}t')]
    ts[0].text = value
    ts[0].set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    for t in ts[1:]:
        t.text = ''

def token(n, key):
    put(n, '{{' + key + '}}')

def rows(tbl):
    return tbl.findall('w:tr', NS)

def cells(row):
    return row.findall('w:tc', NS)

def paras(n):
    return n.findall('w:p', NS)

def repeat(tbl, first, last, keys, block='items'):
    rs = rows(tbl)
    prototypes = rs[first:last]
    # Keep both row formats where the reference uses different top/bottom edges.
    for row in prototypes:
        for c, key in zip(cells(row), keys):
            ps = [p for p in paras(c) if txt(p).strip()]
            if key == 'itemFullName' and len(ps) > 1:
                token(ps[0], 'itemName'); token(ps[1], 'itemDescription')
                for p in ps[2:]: put(p, '')
            else:
                token(c, key)
    for i, row in enumerate(prototypes):
        at = list(tbl).index(row)
        tbl.insert(at, E.Comment(f'{block}:{i}:start'))
        tbl.insert(at + 2, E.Comment(f'{block}:{i}:end'))

def signature(row):
    for c, side in zip(cells(row), ['customer', 'executor']):
        for p in paras(c):
            s = txt(p)
            if not s.strip():
                continue
            if '_' in s:
                # Keep the signature line in its original run and the name in its own run.
                ts = p.findall('.//w:t', NS)
                name_nodes = [t for t in ts if '_' not in (t.text or '') and (t.text or '').strip()]
                if name_nodes:
                    name_nodes[0].text = ' {{' + side + 'Signature}}'
                    for t in name_nodes[1:]: t.text = ''
                else:
                    put(p, s.split('/')[0] + '/ {{' + side + 'Signature}}')
            elif 'М.' in s:
                token(p, side + 'Stamp')
            else:
                token(p, side + 'Position')

def requisites(tbl, separate):
    rs = rows(tbl)
    if separate:
        for c, key in zip(cells(rs[0]), ['customerRole', 'executorRole']): token(c, key)
        for c, key in zip(cells(rs[1]), ['customerShortTitle', 'executorShortTitle']): token(c, key)
        start = 2
    else:
        for c, side in zip(cells(rs[0]), ['customer', 'executor']):
            ps = [p for p in paras(c) if txt(p).strip()]
            token(ps[0], side + 'RoleColon')
            if len(ps)>2:
                token(ps[1], side + 'HeadTitle')
                token(ps[2], side + 'HeadName')
                for p in ps[3:]:put(p,'')
            else:
                token(ps[1], side + 'Title')
        start = 1
    mapping = {'ОГРН': 'Registration', 'ОГРНИП': 'Registration', 'Паспорт': 'Registration',
               'ИНН / КПП': 'Tax', 'ИНН': 'Tax', 'Адрес': 'Address', 'Р/с': 'Account',
               'Банк': 'Bank', 'К/с': 'Corr', 'БИК': 'Bik', 'E-mail': 'Email'}
    for row in rs[start:]:
        cs = cells(row)
        if len(cs) == 2:
            signature(row)
            continue
        for idx, side in [(0, 'customer'), (2, 'executor')]:
            key = mapping[txt(cs[idx])]
            token(cs[idx], side + key + 'Label')
            token(cs[idx + 1], side + key)

def preamble(p, side):
    ts = p.findall('.//w:t', NS)
    ts[0].text = '{{' + side + 'PreambleName}}'
    ts[1].text = '{{' + side + 'PreambleTail}}'
    for t in ts[2:]: t.text = ''

def prepare_contract(files, variant):
    root = E.fromstring(files['word/document.xml'])
    body = root.find('w:body', NS)
    ns = list(body)
    service = variant == 'services'
    token(ns[1], 'contractTitle')
    for c, key in zip(cells(rows(ns[2])[0]), ['city', 'date']): token(c, key)
    preamble(ns[3], 'executor'); preamble(ns[4], 'customer')
    token(ns[8], 'subjectClause')
    # Preserve all generic clauses. Only the payment fields and transaction-specific text vary.
    token(ns[23], 'paymentClause')
    if service:
        ts=ns[22].findall('.//w:t',NS)
        for t,value in zip(ts,['{{priceLead}}','{{amountWithWords}}',' {{vatLine}}']):t.text=value
        for t in ts[3:]:t.text=''
    requisites(ns[43], service)
    if service: signature(rows(ns[45])[0])
    spec_index = 54 if service else (53 if variant == 'supply-ip' else 52)
    for n in ns[44:spec_index]:
        s = txt(n)
        if s.startswith('к Договору'): token(n, 'appendixContract')
        if s.startswith('№'): token(n, 'appendixReference')
    spec = ns[spec_index]
    rs = rows(spec)
    group = len(cells(rs[1])) == 2
    if group: token(cells(rs[1])[1], 'itemGroup')
    keys = ['itemNumber', 'itemName', 'itemDescription', 'itemUnit', 'itemQuantity', 'itemPrice', 'itemTotal'] if service else ['itemNumber', 'itemFullName', 'itemUnit', 'itemQuantity', 'itemPrice', 'itemTotal']
    repeat(spec, 2 if group else 1, len(rs)-1, keys)
    total_cells = cells(rs[-1])
    token(total_cells[-2], 'totalLabel'); token(total_cells[-1], 'total')
    token(ns[spec_index+1], 'appendixPayment')
    token(ns[spec_index+2], 'appendixTotal')
    token(ns[spec_index+3], 'deadline')
    signature(rows(ns[spec_index+4])[0])
    # Transaction roles in unchanged clauses must follow the selected deal type.
    role_words = {'Поставщик':'executorRole', 'Поставщика':'executorGen', 'Поставщику':'executorDat',
                  'Поставщиком':'executorInstrumental', 'Покупатель':'customerRole', 'Покупателя':'customerGen',
                  'Покупателю':'customerDat', 'Покупателем':'customerInstrumental',
                  'Исполнитель':'executorRole', 'Исполнителя':'executorGen', 'Исполнителю':'executorDat',
                  'Исполнителем':'executorInstrumental', 'Заказчик':'customerRole', 'Заказчика':'customerGen',
                  'Заказчику':'customerDat', 'Заказчиком':'customerInstrumental'}
    import re
    for t in root.findall('.//w:t', NS):
        text = t.text or ''
        text = re.sub(r'\b(' + '|'.join(role_words) + r')\b', lambda m: '{{'+role_words[m[0]]+'}}', text)
        if service:
            text = text.replace('оказать Услуги', '{{verbObject}}').replace('Услуг, оказываемых', '{{objectQuality}}')
        t.text = text
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    return files

def prepare_invoice(files):
    root = E.fromstring(files['word/document.xml']); b = list(root.find('w:body', NS))
    token(b[0], 'invoiceTitle')
    for row, key in zip(rows(b[2]), ['invoiceExecutor', 'invoiceCustomer', 'invoiceBasis']): token(cells(row)[1], key)
    rs = rows(b[4]); stop = next(i for i, r in enumerate(rs) if 'ИТОГО' in txt(r))
    repeat(b[4], 1, stop, ['invoiceItemNumber', 'itemName', 'itemUnit', 'itemQuantity', 'itemPrice', 'itemTotal'])
    for r in rs[stop:]:
        if 'НДС:' in txt(r):
            token(cells(r)[0], 'invoiceVatLabel'); token(cells(r)[1], 'invoiceVat')
        else: token(cells(r)[-1], 'total')
    token(b[5], 'invoiceCount'); token(b[6], 'amountWords')
    for c, key in zip(cells(rows(b[8])[0]), ['executorPosition', 'executorSignature']): token(c, key)
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    h = E.fromstring(files['word/header2.xml']); rs = rows(h.find('w:tbl', NS))
    token(paras(cells(rs[0])[0])[0], 'executorBank')
    token(cells(rs[0])[-1], 'executorBik'); token(cells(rs[1])[-1], 'executorCorr')
    token(cells(rs[2])[1], 'executorInn'); token(cells(rs[2])[3], 'executorKpp'); token(cells(rs[2])[-1], 'executorAccount')
    token(paras(cells(rs[3])[0])[0], 'executorTitle')
    files['word/header2.xml'] = E.tostring(h, xml_declaration=True, encoding='UTF-8', standalone=True)
    return files

def prepare_act(files):
    # No approved act was supplied: reuse the contract's typography and borderless tables.
    files = prepare_contract(files, 'services')
    root = E.fromstring(files['word/document.xml']); body = root.find('w:body', NS); ns=list(body)
    title=deepcopy(ns[0]); token(title, 'actTitle')
    ref=deepcopy(ns[1]); token(ref, 'actReference')
    date=deepcopy(ns[2]); token(cells(rows(date)[0])[1], 'actDate')
    intro=deepcopy(ns[5]); token(intro, 'actIntro')
    clauses=[]
    for key in ['actDelivery', 'actPayment', 'actClaims']:
        p=deepcopy(ns[8]); token(p,key); clauses.append(p)
    heading=deepcopy(ns[42]); put(heading, 'Реквизиты сторон')
    for n in list(body):body.remove(n)
    for n in [title,ref,date,ns[3],ns[4],intro,ns[6],*clauses,ns[9],heading,ns[43],ns[44],ns[45],ns[-1]]:body.append(n)
    files['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    return files

def load(path):
    with ZipFile(path) as z:return {n:z.read(n) for n in z.namelist()}

def save(name, files):
    OUT.mkdir(exist_ok=True)
    with ZipFile(OUT/name,'w',ZIP_STORED) as z:
        for n,data in files.items():z.writestr(n,data)

def prepare_upd(files):
    """Retain the Excel form, styles and print settings; remove all example data."""
    S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    ns={'s':S}
    root=E.fromstring(files['xl/worksheets/sheet1.xml'])
    shared=list(E.fromstring(files['xl/sharedStrings.xml']))
    data=root.find('s:sheetData',ns)
    variable=set('R2 AA2 C6 Y5 Y6 Y7 Y8 Y9 AA10 AK10 AB11 AK11 AZ11 Y12 Y13 Y14 AO27 BD27 BJ27 A30 AG29 BS29 AG31 AY31 W34 Q36 A39 Z39 AR39 BR39 A46 Z46 AR46 BR46 A49 AR49'.split())
    for row in list(data):
        number=int(row.get('r'))
        if number>51:
            data.remove(row)
            continue
        for c in row:
            if 21<=number<=26 or c.get('r') in variable:
                for n in list(c):c.remove(n)
                c.attrib.pop('t',None)
            elif c.get('t')=='s':
                si=shared[int(c.find('s:v',ns).text)]
                for n in list(c):c.remove(n)
                c.set('t','inlineStr')
                inline=E.SubElement(c,f'{{{S}}}is')
                for n in si:inline.append(deepcopy(n))
    # Shared strings may retain removed names, bank details and descriptions.
    del files['xl/sharedStrings.xml']
    for name in ['xl/_rels/workbook.xml.rels','[Content_Types].xml']:
        r=E.fromstring(files[name])
        for n in list(r):
            if 'sharedStrings' in str(n.attrib):r.remove(n)
        files[name]=E.tostring(r,xml_declaration=True,encoding='UTF-8',standalone=True)
    files['xl/worksheets/sheet1.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    return files

if __name__ == '__main__':
    source=Path(sys.argv[1])
    samples={
        'supply-org':next(source.glob('*Договор*Байлык*')),
        'supply-ip':next(source.glob('*Договор*Шейлан*')),
        'services':next(source.glob('*Договор*Жиров*')),
        'invoice-org':next(source.glob('*Счет*04-26_1*')),
        'invoice-ip':next(source.glob('*Счет*Шейлан*')),
    }
    for name,path in samples.items():
        if not name.startswith('invoice'): continue
        files=load(path)
        files=prepare_invoice(files) if name.startswith('invoice') else prepare_contract(files,name)
        save(name+'.docx',files)
    save('act.docx',prepare_act(load(samples['services'])))
    save('upd.xlsx',prepare_upd(load(next(source.glob('*.xlsx')))))
    print('Prepared invoices, act and UPD; contracts use prepare-approved-contract.py')
