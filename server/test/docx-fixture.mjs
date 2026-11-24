import JSZip from 'jszip';

export const repeated = 'Prepared routine fictional reports.';
export const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rels = 'http://schemas.openxmlformats.org/package/2006/relationships';
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const types = 'http://schemas.openxmlformats.org/package/2006/content-types';
const escapes = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function paragraph(text, { properties = '', format = '', styles = null, paraId = '' } = {}) {
  const fragments = Array.isArray(text) ? text : [text];
  const runs = fragments.map((piece, index) => '<w:r>' + ((styles?.[index] || format) ? '<w:rPr>' + (styles?.[index] || format) + '</w:rPr>' : '') +
    '<w:t xml:space="preserve">' + escapes(piece) + '</w:t></w:r>').join('');
  return '<w:p' + (paraId ? ' w14:paraId="' + paraId + '"' : '') + '>' + (properties ? '<w:pPr>' + properties + '</w:pPr>' : '') + runs + '</w:p>';
}

const numbered = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>';
const bulleted = '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>';
const custom = '<w:pStyle w:val="ResumeBody"/>';
const letter = '<w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/><w:i/><w:u w:val="single"/><w:sz w:val="22"/>';
const section = '<w:headerReference w:type="default" r:id="h"/><w:footerReference w:type="default" r:id="f"/>' +
  '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="400" w:footer="400"/>';
const template = ({ reversed, complex, overflow }) => [
  paragraph('Fictional Candidate', { format: '<w:b/>' }),
  paragraph('Summary', { format: '<w:b/>' }),
  paragraph('Prepared internal reports for a fictional organization.', { properties: custom }),
  paragraph('Experience', { format: '<w:b/>' }),
  paragraph('Engineer | Fictional North Labs', { styles: ['<w:b/>'] }),
  paragraph(repeated, { properties: numbered, paraId: 'AAAA0001' }),
  paragraph('Engineer | Fictional South Labs'),
  paragraph(['Prepared routine ', 'fictional reports.'], { properties: numbered + custom, format: letter, paraId: 'BBBB0002' }),
  ...(reversed ? [paragraph('Position changed after review.')] : []),
  ...(overflow ? Array.from({ length: 95 }, () => paragraph('Fictional repeated layout material.')) : []),
  paragraph('Skills'),
  paragraph('General office tools', { properties: custom }),
  ...(complex ? [
    paragraph(['Mixed ', 'bold'], { styles: ['', '<w:b/>'] }),
    '<w:p><w:hyperlink r:id="link"><w:r><w:t>Fictional site</w:t></w:r></w:hyperlink></w:p>',
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    '<w:p><w:r><w:pict><w:txbxContent>' + paragraph('Fictional boxed text') + '</w:txbxContent></w:pict></w:r></w:p>',
    '<w:ins w:id="1" w:author="Fictional"><w:p><w:r><w:t>Tracked example</w:t></w:r></w:p></w:ins>',
    '<w:sdt><w:sdtPr/><w:sdtContent>' + paragraph('Content control example') + '</w:sdtContent></w:sdt>',
    '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4600"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:tbl><w:tr><w:tc>' +
      paragraph('Nested cell') + '</w:tc></w:tr></w:tbl>' + paragraph('Simple cell text') +
      paragraph(repeated, { properties: bulleted }) + '</w:tc></w:tr></w:tbl>',
    '<w:p><w:pPr><w:sectPr>' + section + '</w:sectPr></w:pPr></w:p>',
  ] : []),
  '<w:sectPr>' + section + '</w:sectPr>',
].join('');

export async function makeDocx(options = {}) {
  const zip = new JSZip();
  const prefix = '<w:document xmlns:w="' + word + '" xmlns:r="' + office.slice(0, -1) + '" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>';
  const parts = ['document', 'styles', 'numbering', 'header1', 'footer1'];
  const type = ['document.main', 'styles', 'numbering', 'header', 'footer'];
  zip.file('[Content_Types].xml', '<Types xmlns="' + types + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' + parts.map((name, index) =>
      '<Override PartName="/word/' + name + '.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.' + type[index] + '+xml"/>').join('') + '</Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="' + rels + '"><Relationship Id="document" Type="' + office + 'officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', options.xml || prefix + (options.body || template(options)) + '</w:body></w:document>');
  zip.file('word/styles.xml', '<w:styles xmlns:w="' + word + '"><w:style w:type="paragraph" w:styleId="ResumeBody">' +
    '<w:name w:val="Resume Body"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="120"/></w:pPr></w:style>' +
    '<w:style w:type="character" w:styleId="PrivateBase"><w:name w:val="Private Base"/><w:rPr><w:vanish/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="PrivateRun"><w:name w:val="Private Run"/><w:basedOn w:val="PrivateBase"/></w:style></w:styles>');
  zip.file('word/numbering.xml', '<w:numbering xmlns:w="' + word + '"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">' +
    '<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/>' +
    '<w:lvlText w:val="•"/><w:lvlJc w:val="left"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>');
  zip.file('word/header1.xml', '<w:hdr xmlns:w="' + word + '">' + paragraph(repeated) + '</w:hdr>');
  zip.file('word/footer1.xml', '<w:ftr xmlns:w="' + word + '">' + paragraph('Fictional footer') + '</w:ftr>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="' + rels + '">' +
    [['h', 'header', 'header1.xml'], ['f', 'footer', 'footer1.xml'], ['styles', 'styles', 'styles.xml'], ['list', 'numbering', 'numbering.xml']]
      .map(([id, type, target]) => '<Relationship Id="' + id + '" Type="' + office + type + '" Target="' + target + '"/>').join('') +
    '<Relationship Id="link" Type="' + office + (options.unsafe ? 'attachedTemplate' : 'hyperlink') +
    '" Target="https://fictional.example.test/" TargetMode="External"/></Relationships>');
  return zip.generateAsync({ type: 'nodebuffer' });
}
