"""Build the sole approved contract from a private DOCX; never commit the input.
Usage: python prepare-approved-contract.py /path/to/approved.docx
Only variable text is replaced. All original formatting and static clauses survive.
"""
from pathlib import Path
from zipfile import ZipFile, ZIP_STORED
from lxml import etree as E
import sys
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main'; NS={'w':W}
def text(p): return ''.join(p.xpath('.//w:t/text()',namespaces=NS))
def replace(p, old, value):
    full=text(p); start=full.index(old); end=start+len(old); pos=0; inserted=False
    for t in p.findall('.//w:t',NS):
        s=t.text or ''; a,b=pos,pos+len(s);pos=b
        if b<=start or a>=end:continue
        t.text=s[:max(0,start-a)]+(value if not inserted else '')+s[max(0,end-a):]
        t.set('{http://www.w3.org/XML/1998/namespace}space','preserve');inserted=True
    assert inserted

def build(source,out):
    with ZipFile(source) as z:files={n:z.read(n) for n in z.namelist()}
    root=E.fromstring(files['word/document.xml']);ps=root.findall('.//w:p',NS)
    assert len(ps)==127 and 'Налог на профессиональный доход' in text(ps[23]),'Unexpected approved document structure'
    tok=lambda i,key:replace(ps[i],text(ps[i]).strip(),'{{'+key+'}}')
    for i,key in {1:'contractTitle',2:'city',3:'date',47:'customerShortTitle',51:'customerRegistration',53:'executorRegistration',55:'customerAddress',57:'executorAddress',59:'customerTax',61:'executorTax',63:'customerAccount',65:'executorAccount',67:'customerBank',69:'executorBank',71:'customerCorr',73:'executorCorr',75:'customerBik',77:'executorBik',79:'customerPosition',82:'executorName',88:'appendixReference',102:'itemName',103:'itemDescription',104:'itemUnit',105:'itemQuantity',106:'itemPrice',107:'itemTotal',110:'total',115:'customerPosition',118:'executorName'}.items():tok(i,key)
    # Keep bold names and normal preamble tails in their original runs.
    p=ps[4];s=text(p);replace(p,s.split(',')[0][len('Гражданин '):],'{{executorName}}');replace(p,'Гражданин','Самозанятый')
    s=text(p);replace(p,s.split('доход от ')[1].split(' №')[0],'{{npdDate}}');s=text(p);replace(p,s.split(' № ')[1].split(',')[0],'{{npdNumber}}')
    p=ps[5];s=text(p);replace(p,s.split(', в лице ')[0],'{{customerTitle}}');s=text(p);replace(p,s.split(', в лице ')[1].split(', действующего')[0],'{{customerSignerGen}}');s=text(p);replace(p,s.split('на основании ')[1].split(', именуемый')[0],'{{customerBasis}}')
    p=ps[9];s=text(p);replace(p,s.split('оказать услугу: ')[1].split(', а Заказчик')[0],'{{serviceSubject}}')
    for i in [23,112]:
        p=ps[i];s=text(p);replace(p,s.split('составляет: ')[1].split(' НДС')[0],'{{amountWithWords}}')
    p=ps[49];replace(p,text(p)[len('Самозанятый '):],'{{executorName}}')
    for i,side in [(80,'customer'),(84,'executor'),(116,'customer'),(120,'executor')]:
        p=ps[i];replace(p,text(p).split('/ ')[1],'{{'+side+'Signature}}')
    p=ps[113];s=text(p);replace(p,s[len('Срок оказания услуг: '):],'{{servicePeriod}}')
    row=root.findall('.//w:tbl',NS)[3].findall('w:tr',NS)[2]
    replace(row,'1.1','{{itemNumber}}');parent=row.getparent();at=parent.index(row)
    parent.insert(at,E.Comment('items:0:start'));parent.insert(at+2,E.Comment('items:0:end'))
    files['word/document.xml']=E.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
    # This reference has no private metadata parts; reject unexpected additions.
    assert not any(n.startswith(('docProps/','word/comments','word/people')) for n in files)
    out.parent.mkdir(parents=True,exist_ok=True)
    with ZipFile(out,'w',ZIP_STORED) as z:
        for n,data in files.items():z.writestr(n,data)
if __name__=='__main__':build(Path(sys.argv[1]),Path(__file__).resolve().parents[1]/'docs/templates/services.docx')
