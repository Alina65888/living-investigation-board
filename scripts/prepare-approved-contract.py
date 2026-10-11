"""Prepare the supplied NPD contract and act without rebuilding their formatting.
Usage: python prepare-approved-contract.py CONTRACT.docx [ACT.docx]
Private source files and filled previews must never be committed.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
from lxml import etree as E
import importlib.util
import sys
spec=importlib.util.spec_from_file_location('office',Path(__file__).with_name('prepare-document-templates.py'))
office=importlib.util.module_from_spec(spec);spec.loader.exec_module(office)
W=office.W;NS=office.NS
text=office.txt

def replace(p, old, value):
    full=text(p);start=full.index(old);end=start+len(old);pos=0;inserted=False
    for t in p.findall('.//w:t',NS):
        s=t.text or '';a,b=pos,pos+len(s);pos=b
        if b<=start or a>=end:continue
        t.text=s[:max(0,start-a)]+(value if not inserted else '')+s[max(0,end-a):]
        t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');inserted=True
    assert inserted

def preambles(body):
    p=body[3];s=text(p)
    replace(p,s.split(',')[0],'Самозанятый {{executorName}}')
    s=text(p);replace(p,s.split('доход от ')[1].split(' №')[0],'{{npdDate}}')
    s=text(p);replace(p,s.split(' № ')[1].split(',')[0],'{{npdNumber}}')
    p=body[4];s=text(p);name=s.split(', в лице ')[0]
    replace(p,name,'{{customerTitle}}');replace(p,s[len(name):],'{{customerPreambleTail}}')

def requisites(table):
    office.requisites(table,False)
    for cell,key in zip(office.cells(office.rows(table)[0]),['customerShortTitle','executorNpdTitle']):
        office.token(office.paras(cell)[1],key)

def save(files,root,out):
    files['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    assert not any(n.startswith(('docProps/','word/comments','word/people')) for n in files)
    out.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(out,'w',ZIP_STORED) as z:
        for n,data in files.items():z.writestr(n,data)

def build(source,out):
    files=office.load(source);root=E.fromstring(files['word/document.xml']);body=list(root.find('w:body',NS))
    assert len(body)==63 and 'Налог на профессиональный доход' in text(body[22]),'Unexpected NPD contract layout'
    office.token(body[1],'contractTitle')
    for c,k in zip(office.cells(office.rows(body[2])[0]),['city','date']):office.token(c,k)
    preambles(body)
    p=body[8];s=text(p);replace(p,s.split('оказать услугу: ')[1].split(', а Заказчик')[0],'{{serviceSubject}}')
    for i in [22,57]:
        p=body[i];s=text(p);replace(p,s.split('составляет: ')[1].split(' НДС')[0],'{{amountWithWords}}')
    requisites(body[45]);office.signature(office.rows(body[47])[0])
    office.token(body[51],'appendixReference')
    table=body[55];rs=office.rows(table)
    office.repeat(table,2,len(rs)-1,['itemNumber','itemName','itemDescription','itemUnit','itemQuantity','itemPrice','itemTotal'])
    office.token(office.cells(rs[-1])[-1],'total')
    replace(body[58],text(body[58])[len('Срок оказания услуг: '):],'{{servicePeriod}}')
    office.signature(office.rows(body[60])[0])
    save(files,root,out)

def build_act(source,out):
    files=office.load(source);root=E.fromstring(files['word/document.xml']);body=list(root.find('w:body',NS))
    assert len(body)==16 and 'об исполнении обязательств' in text(body[1]),'Unexpected NPD act layout'
    # Keep the explicit source line break: title, subtitle, contract reference.
    ref=body[1].findall('.//w:t',NS)
    assert len(ref)==2 and body[1].find('.//w:br',NS) is not None
    ref[1].text='{{actContractReference}}'
    for c,k in zip(office.cells(office.rows(body[2])[0]),['city','actDate']):office.token(c,k)
    preambles(body)
    # Paragraph numbering is native Word numbering in this source.
    office.token(body[6],'npdActDelivery');office.token(body[7],'npdActPayment')
    requisites(body[11]);office.signature(office.rows(body[13])[0])
    save(files,root,out)

if __name__=='__main__':
    out=Path(__file__).resolve().parents[1]/'docs/templates'
    build(Path(sys.argv[1]),out/'services.docx')
    if len(sys.argv)>2:build_act(Path(sys.argv[2]),out/'act-npd.docx')
