"""Create a portable text slide deck from JSON using Python's standard library.

Usage: python create_deck.py slides.json output.pptx
Input: {"slides": [{"title": "Title", "bullets": ["Point", "Point"]}]}
"""
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
DRAW = 'http://schemas.openxmlformats.org/drawingml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'


def relationships(items):
    return f'<Relationships xmlns="{PKG}">' + ''.join(
        f'<Relationship Id="rId{i}" Type="{REL}/{kind}" Target="{escape(target)}"/>'
        for i, (kind, target) in enumerate(items, 1)) + '</Relationships>'


def shape(identity, text, y, size, bold=False):
    paragraphs = ''.join(f'<a:p><a:r><a:rPr lang="en-US" sz="{size}" b="{int(bold)}"/><a:t>{escape(str(line))}</a:t></a:r></a:p>' for line in text)
    return f'<p:sp><p:nvSpPr><p:cNvPr id="{identity}" name="Text {identity}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="{y}"/><a:ext cx="10820400" cy="{1000000 if bold else 4500000}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>'


def create(data, output):
    slides = data['slides']
    if not isinstance(slides, list) or not 1 <= len(slides) <= 200:
        raise ValueError('Expected between 1 and 200 slides')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise FileExistsError(output)
    group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
    with ZipFile(output, 'x', ZIP_DEFLATED) as archive:
        types = [('/ppt/presentation.xml', 'presentationml.presentation.main'), ('/ppt/slideMasters/slideMaster1.xml', 'presentationml.slideMaster'), ('/ppt/slideLayouts/slideLayout1.xml', 'presentationml.slideLayout')]
        types += [(f'/ppt/slides/slide{i}.xml', 'presentationml.slide') for i in range(1, len(slides) + 1)]
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + ''.join(f'<Override PartName="{name}" ContentType="application/vnd.openxmlformats-officedocument.{kind}+xml"/>' for name, kind in types) + '</Types>')
        archive.writestr('_rels/.rels', relationships([('officeDocument', 'ppt/presentation.xml')]))
        ids = ''.join(f'<p:sldId id="{255+i}" r:id="rId{i+1}"/>' for i in range(1, len(slides)+1))
        archive.writestr('ppt/presentation.xml', f'<p:presentation xmlns:p="{NS}" xmlns:a="{DRAW}" xmlns:r="{REL}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>')
        archive.writestr('ppt/_rels/presentation.xml.rels', relationships([('slideMaster', 'slideMasters/slideMaster1.xml')] + [('slide', f'slides/slide{i}.xml') for i in range(1, len(slides)+1)]))
        archive.writestr('ppt/slideMasters/slideMaster1.xml', f'<p:sldMaster xmlns:p="{NS}" xmlns:a="{DRAW}" xmlns:r="{REL}"><p:cSld><p:spTree>{group}</p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>')
        archive.writestr('ppt/slideMasters/_rels/slideMaster1.xml.rels', relationships([('slideLayout', '../slideLayouts/slideLayout1.xml')]))
        archive.writestr('ppt/slideLayouts/slideLayout1.xml', f'<p:sldLayout xmlns:p="{NS}" xmlns:a="{DRAW}" type="blank"><p:cSld name="Blank"><p:spTree>{group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')
        archive.writestr('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relationships([('slideMaster', '../slideMasters/slideMaster1.xml')]))
        for i, slide in enumerate(slides, 1):
            bullets = slide.get('bullets', slide.get('body', []))
            if isinstance(bullets, str):
                bullets = bullets.splitlines()
            text = shape(2, [slide.get('title', '')], 500000, 3200, True) + shape(3, bullets, 1750000, 2200)
            archive.writestr(f'ppt/slides/slide{i}.xml', f'<p:sld xmlns:p="{NS}" xmlns:a="{DRAW}"><p:cSld><p:spTree>{group}{text}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>')
            archive.writestr(f'ppt/slides/_rels/slide{i}.xml.rels', relationships([('slideLayout', '../slideLayouts/slideLayout1.xml')]))
    return str(output)


if __name__ == '__main__':
    print(create(json.loads(Path(sys.argv[1]).read_text(encoding='utf-8')), sys.argv[2]))
