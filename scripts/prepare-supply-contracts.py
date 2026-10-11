"""Prepare the supplied IP and organisation contracts without replacing NPD services.

Usage: prepare-supply-contracts.py IP.docx ORGANISATION.docx
Private source documents stay outside the repository.
"""
from pathlib import Path
import importlib.util
import sys
from lxml import etree as E

spec = importlib.util.spec_from_file_location('office', Path(__file__).with_name('prepare-document-templates.py'))
office = importlib.util.module_from_spec(spec)
spec.loader.exec_module(office)

def build(source, variant):
    files = office.load(source)
    original = E.fromstring(files['word/document.xml'])
    source_body = list(original.find('w:body', office.NS))
    assert len(source_body) == (60 if variant == 'supply-ip' else 59), 'Unexpected contract layout'
    files = office.prepare_contract(files, variant)
    root = E.fromstring(files['word/document.xml'])
    body = root.find('w:body', office.NS)
    # These are fixed terms in both approved supply samples, not the editable
    # payment period of a legacy deal and not the NPD calendar-day clause.
    body.replace(body[23], source_body[23])
    spec_index = 53 if variant == 'supply-ip' else 52
    body.replace(body[spec_index + 1], source_body[spec_index + 1])
    files['word/document.xml'] = E.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    assert not any(n.startswith(('docProps/', 'word/comments', 'word/people')) for n in files)
    office.save(variant + '.docx', files)

if __name__ == '__main__':
    build(Path(sys.argv[1]), 'supply-ip')
    build(Path(sys.argv[2]), 'supply-org')
