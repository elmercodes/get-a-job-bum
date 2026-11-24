import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import mammoth from 'mammoth';
import { validateUpload } from './uploads.js';

export const PART = 'word/document.xml';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML = 'http://www.w3.org/XML/1998/namespace';
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const normalizedText = (value) => String(value).normalize('NFC').replace(/\s+/gu, ' ').trim();

export class DocxError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = ['STALE_SOURCE', 'STALE_EVIDENCE', 'STALE_JOB', 'VERSION_CONFLICT'].includes(code) ? 409 : 422;
  }
}

const word = (node, name) => node?.uri === W && node.local === name;
const attribute = (node, name, uri = W) => Object.values(node?.attributes || {}).find((attr) => attr.local === name && attr.uri === uri)?.value;
const child = (node, name) => node.children.find((item) => word(item, name));

function parseXml(text) {
  const stack = [];
  const parser = new SaxesParser({ xmlns: true });
  let root;
  let count = 0;
  parser.on('error', () => { throw new DocxError('INVALID_XML', 'The document contains malformed XML.'); });
  parser.on('doctype', () => { throw new DocxError('UNSAFE_XML', 'Document type and entity declarations are unsupported.'); });
  parser.on('xmldecl', ({ encoding }) => {
    if (encoding && encoding.toLowerCase() !== 'utf-8') throw new DocxError('ENCODING', 'Only UTF-8 Word parts are supported.');
  });
  parser.on('opentag', (tag) => {
    if (++count > 130000 || stack.length > 64) throw new DocxError('XML_LIMIT', 'The document structure exceeds the processing limit.');
    const parent = stack.at(-1);
    const node = {
      uri: tag.uri, local: tag.local, attributes: tag.attributes, children: [], text: '',
      start: text.lastIndexOf('<', parser.position - 1), openEnd: parser.position,
      index: parent?.children.length ?? 0, selfClosing: tag.isSelfClosing, special: false,
    };
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  parser.on('text', (value) => { if (stack.length) stack.at(-1).text += value; });
  for (const event of ['cdata', 'comment', 'processinginstruction']) {
    parser.on(event, () => { if (stack.length) stack.at(-1).special = true; });
  }
  parser.on('closetag', () => {
    const node = stack.pop();
    node.end = parser.position;
    node.innerEnd = node.selfClosing ? node.openEnd : text.lastIndexOf('<', node.end - 1);
  });
  parser.write(text).close();
  if (!root) throw new DocxError('INVALID_XML', 'A required Word XML part is empty.');
  return root;
}

function visit(node, callback, chain = []) {
  callback(node, chain);
  const next = [...chain, node];
  for (const item of node.children) visit(item, callback, next);
}

function shape(xml, node, spans) {
  let result = '';
  let from = node.start;
  for (const span of spans) {
    result += xml.slice(from, span.openEnd);
    from = span.innerEnd;
  }
  return hash(result + xml.slice(from, node.end));
}

function attributesKey(node) {
  return Object.values(node.attributes).filter((item) => item.uri !== 'http://www.w3.org/2000/xmlns/')
    .map((item) => [item.uri, item.local, item.value]).sort();
}

function propertiesKey(node) {
  return node ? [node.uri, node.local, attributesKey(node), node.text.trim(), node.children.map(propertiesKey)] : null;
}

const hidden = (properties) => properties?.children.some((item) =>
  item.uri === W && ['vanish', 'webHidden', 'specVanish'].includes(item.local));

function styleRules(root) {
  const styles = new Map();
  const defaults = new Map();
  for (const item of root.children.filter((node) => word(node, 'style'))) {
    const id = attribute(item, 'styleId');
    if (!id) continue;
    const type = attribute(item, 'type');
    if (['1', 'true', 'on'].includes(attribute(item, 'default'))) defaults.set(type, id);
    styles.set(id, { parent: attribute(child(item, 'basedOn'), 'val'), hidden: hidden(child(item, 'rPr')),
      numbered: Boolean(child(item, 'pPr') && child(child(item, 'pPr'), 'numPr')) });
  }
  const inherited = (id, flag) => {
    const seen = new Set();
    while (id && styles.has(id) && !seen.has(id)) {
      seen.add(id);
      const style = styles.get(id);
      if (style[flag]) return true;
      id = style.parent;
    }
    return false;
  };
  const docDefaults = child(root, 'docDefaults');
  const runDefaults = docDefaults && child(docDefaults, 'rPrDefault');
  return {
    hiddenByDefault: hidden(runDefaults && child(runDefaults, 'rPr')),
    hidden: (id, type) => inherited(id || defaults.get(type), 'hidden'),
    numbered: (id) => inherited(id || defaults.get('paragraph'), 'numbered'),
  };
}

function paragraphInfo(xml, node, chain, section, styles) {
  const structure = [...chain, node].map(({ uri, local }) => uri === W ? local : '?').join('/');
  let issue = '';
  if (!['document/body/p', 'document/body/tbl/tr/tc/p'].includes(structure)) issue = 'unsupported_container';
  const runs = node.children.filter((item) => word(item, 'r'));
  const props = child(node, 'pPr');
  const style = attribute(props && child(props, 'pStyle'), 'val') || '';
  if (node.children.some((item) => !word(item, 'r') && !word(item, 'pPr')) ||
      runs.some((run) => run.children.some((item) => !word(item, 'rPr') && !word(item, 't')))) {
    issue ||= 'complex_paragraph';
  }
  if (props && child(props, 'framePr')) issue ||= 'positioned_paragraph';
  if (props && child(props, 'pPrChange') || runs.some((run) => {
    const runProps = child(run, 'rPr');
    return runProps && child(runProps, 'rPrChange');
  })) issue ||= 'complex_paragraph';
  const visibleRuns = runs.filter((run) => run.children.some((item) => word(item, 't') && item.text));
  const formats = new Set(visibleRuns.map((run) => JSON.stringify([attributesKey(run).filter(([uri]) => uri !== W), propertiesKey(child(run, 'rPr'))])));
  if (formats.size > 1) issue ||= 'mixed_run_formatting';
  if (styles?.hiddenByDefault || styles?.hidden(style, 'paragraph') || hidden(props && child(props, 'rPr')) ||
      runs.some((run) => {
        const runProps = child(run, 'rPr');
        return hidden(runProps) || styles?.hidden(attribute(runProps && child(runProps, 'rStyle'), 'val'), 'character');
      })) {
    issue ||= 'hidden_text';
  }
  const spans = [];
  visit(node, (item) => { if (word(item, 't')) spans.push(item); });
  if (spans.some((item) => item.children.length || item.special || item.selfClosing || item.text.normalize('NFC') !== item.text) ||
      node.children.some((item) => word(item, 'pPr') && child(item, 'sectPr'))) issue ||= 'complex_text';
  const text = spans.map((item) => item.text).join('');
  if (!text.trim()) issue ||= 'empty_paragraph';
  if (text.length > 3000) issue ||= 'long_paragraph';
  const anchor = {
    part: PART,
    path: [...chain, node].map((item) => item.index),
    section,
    paragraphId: attribute(node, 'paraId', W14) || null,
    container: structure,
    originalHash: hash(xml.slice(node.start, node.end)),
    textHash: hash(normalizedText(text)),
    styleHash: shape(xml, node, spans.filter((span) => !span.selfClosing)),
  };
  const numbered = Boolean(props && child(props, 'numPr')) || Boolean(styles?.numbered(style)) || /list|bullet/i.test(style);
  return {
    anchor, text, spans, style, issue,
    numbered,
    presentation: hash(JSON.stringify([propertiesKey(props), [...formats]])),
    canClear: !style && !numbered && structure === 'document/body/p' && !props,
  };
}

function inspect(xml, styles) {
  const root = parseXml(xml);
  if (!word(root, 'document') || root.children.filter((item) => word(item, 'body')).length !== 1) {
    throw new DocxError('UNSUPPORTED_WORD', 'This source requires a transitional WordprocessingML document body.');
  }
  const paragraphs = [];
  let section = 0;
  let layoutsAtRisk = false;
  visit(root, (node, chain) => {
    if (node.uri !== W) return;
    if (['tbl', 'drawing', 'pict', 'txbxContent', 'ins', 'del', 'sdt', 'fldChar', 'instrText'].includes(node.local) ||
        (word(node, 'cols') && (Number(attribute(node, 'num')) > 1 || node.children.length > 1))) layoutsAtRisk = true;
    if (!word(node, 'p')) return;
    const info = paragraphInfo(xml, node, chain, section, styles);
    paragraphs.push(info);
    const props = child(node, 'pPr');
    if (props && child(props, 'sectPr')) section++;
  });
  paragraphs.forEach((p, index) => {
    p.anchor.before = paragraphs[index - 1]?.anchor.textHash || null;
    p.anchor.after = paragraphs[index + 1]?.anchor.textHash || null;
    p.anchor.id = hash(JSON.stringify(p.anchor)).slice(0, 32);
  });
  return { paragraphs, layoutsAtRisk };
}

function decode(data) {
  try {
    const xml = decoder.decode(data);
    if (xml.includes('\x00')) throw new Error();
    return xml;
  } catch {
    throw new DocxError('ENCODING', 'Only UTF-8 Word parts are supported.');
  }
}

function checkRelationships(root, name) {
  let document = false;
  if (root.uri !== REL || root.local !== 'Relationships') {
    throw new DocxError('INVALID_PACKAGE', 'The Word package has an invalid relationships part.');
  }
  for (const relation of root.children) {
    if (relation.uri !== REL || relation.local !== 'Relationship') continue;
    const mode = attribute(relation, 'TargetMode', '');
    const type = attribute(relation, 'Type', '') || '';
    const target = attribute(relation, 'Target', '') || '';
    if (/\/(?:oleObject|package|activeXControl|activeXControlBinary|attachedTemplate|aFChunk|vbaProject)$/i.test(type)) {
      throw new DocxError('UNSAFE_RELATIONSHIP', 'The package references unsupported embedded or alternative content.');
    }
    if (mode && mode !== 'Internal') {
      const url = URL.canParse(target) ? new URL(target) : null;
      if (mode !== 'External' || !type.endsWith('/hyperlink') || !url ||
          !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new DocxError('UNSAFE_RELATIONSHIP', 'The package references an unsupported external resource.');
      }
    } else if (name === '_rels/.rels' && type.endsWith('/officeDocument') && target.replace(/^\//, '') === PART) {
      document = true;
    }
  }
  return document;
}

export async function readDocx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 6 * 1024 * 1024) throw new DocxError('SIZE_LIMIT', 'The Word file exceeds the size limit.');
  try {
    await validateUpload({ originalname: 'source.docx', buffer }, { resume: true });
  } catch {
    throw new DocxError('INVALID_PACKAGE', 'The Word package is damaged or contains unsupported archive entries.');
  }
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  } catch {
    throw new DocxError('INVALID_ZIP', 'The Word package could not be opened or failed its checksum.');
  }
  let main = '';
  let authorizedMain = false;
  let typeIsWord = false;
  let styles;
  const partHashes = Object.create(null);
  const preserved = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) {
      throw new DocxError('INVALID_PACKAGE', 'A Word archive path is unsafe.');
    }
    const name = entry.name;
    if (/^_xmlsignatures\//i.test(name)) throw new DocxError('SIGNED_PACKAGE', 'Digitally signed packages need a separate unsigned editing copy.');
    const data = await entry.async('nodebuffer');
    partHashes[name] = hash(data);
    if (name === PART) { main = decode(data); continue; }
    if (/\.(?:xml|rels)$/i.test(name)) {
      const root = parseXml(decode(data));
      if (name.endsWith('.rels')) {
        if (checkRelationships(root, name)) authorizedMain = true;
      }
      if (name === 'word/styles.xml' && word(root, 'styles')) styles = styleRules(root);
      if (name === 'word/settings.xml' && word(root, 'settings')) {
        const protection = child(root, 'documentProtection');
        if (['1', 'true', 'on'].includes(attribute(protection, 'enforcement'))) {
          throw new DocxError('PROTECTED_PACKAGE', 'Select an editable copy of this protected Word document.');
        }
      }
      if (name === '[Content_Types].xml' && root.uri === CONTENT && root.local === 'Types') {
        typeIsWord = root.children.some((node) => node.uri === CONTENT && node.local === 'Override' &&
          attribute(node, 'PartName', '') === '/' + PART &&
          attribute(node, 'ContentType', '') === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml');
      }
      if (/^word\/(?:header|footer|footnotes|endnotes|comments)/i.test(name)) preserved.push(name);
    }
  }
  if (!main || !authorizedMain || !typeIsWord) throw new DocxError('INVALID_PACKAGE', 'This file lacks a standard, non-macro Word main document.');
  const details = inspect(main, styles);
  if (details.paragraphs.length > 1600) throw new DocxError('XML_LIMIT', 'The document has too many paragraphs for interactive tailoring.');
  return { ...details, zip, xml: main, partHashes, sourceHash: hash(buffer), preserved };
}

function anchorEqual(left, right) {
  return left && right && ['id', 'part', 'section', 'paragraphId', 'container', 'originalHash',
    'textHash', 'styleHash', 'before', 'after'].every((key) => left[key] === right[key]) &&
    JSON.stringify(left.path) === JSON.stringify(right.path);
}

const escaped = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function planPatches(original, sourceHash, edits) {
  if (sourceHash !== original.sourceHash) throw new DocxError('STALE_SOURCE', 'The original document changed. Create a new review.');
  const indices = new Map(original.paragraphs.map((p, index) => [p.anchor.id, index]));
  const replacements = new Map();
  const patches = [];
  for (const edit of edits) {
    const index = indices.get(edit.anchor?.id);
    const current = original.paragraphs[index];
    // No search by text and no position fallback.
    if (!current || !anchorEqual(current.anchor, edit.anchor) || current.text !== edit.originalText) {
      throw new DocxError('MISSING_TARGET', 'An accepted edit no longer resolves to its exact paragraph.', { editId: edit.id });
    }
    if (replacements.has(index)) throw new DocxError('CONFLICTING_TARGET', 'Two accepted edits address the same paragraph.', { editId: edit.id });
    if (current.issue || (!edit.text && !current.canClear)) {
      throw new DocxError('UNSUPPORTED_REGION', 'An accepted edit targets a read-only region.', { editId: edit.id, issue: current.issue });
    }
    if (typeof edit.text !== 'string' || edit.text.length > 1200 || edit.text !== edit.text.trim() || /[\x00-\x1f\x7f]/.test(edit.text) ||
        /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(edit.text)) {
      throw new DocxError('INVALID_EDIT', 'An accepted edit contains invalid or hidden characters.', { editId: edit.id });
    }
    // Use the first existing non-empty run, preserving character and paragraph properties.
    const lead = current.spans.find((span) => span.text.length > 0);
    for (const span of current.spans) {
      const text = span === lead ? escaped(edit.text) : '';
      if (span === lead && attribute(span, 'space', XML) === 'default' && /^\s|\s$/.test(edit.text)) {
        throw new DocxError('UNSUPPORTED_REGION', 'The requested whitespace cannot be preserved.', { editId: edit.id });
      }
      patches.push({ from: span.openEnd, to: span.innerEnd, text });
    }
    replacements.set(index, edit);
  }
  let xml = original.xml;
  for (const patch of patches.sort((a, b) => b.from - a.from)) {
    xml = xml.slice(0, patch.from) + patch.text + xml.slice(patch.to);
  }
  return { xml, replacements };
}

export async function buildDocx(original, planned) {
  const sourceEntry = original.zip.file(PART);
  original.zip.file(PART, Buffer.from(planned.xml, 'utf8'), {
    date: sourceEntry.date, comment: sourceEntry.comment, createFolders: false,
    unixPermissions: sourceEntry.unixPermissions, dosPermissions: sourceEntry.dosPermissions,
  });
  return original.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function verifyDocx(original, planned, buffer) {
  const output = await readDocx(buffer);
  const parts = Object.keys(original.partHashes);
  if (parts.length !== Object.keys(output.partHashes).length ||
      parts.some((name) => name !== PART && original.partHashes[name] !== output.partHashes[name]) ||
      output.xml !== planned.xml || output.paragraphs.length !== original.paragraphs.length) {
    throw new DocxError('OUTPUT_INTEGRITY', 'One or more protected parts changed or the saved XML differs from the edit plan.');
  }
  for (const [index, before] of original.paragraphs.entries()) {
    const current = output.paragraphs[index];
    const edit = planned.replacements.get(index);
    if ((edit && (current.text !== edit.text || current.anchor.styleHash !== before.anchor.styleHash)) ||
        (!edit && current.anchor.originalHash !== before.anchor.originalHash)) {
      throw new DocxError('OUTPUT_EDIT_MISMATCH', 'Saved text or formatting differs from the approved edit plan.', { editId: edit?.id });
    }
  }
  let extracted;
  try {
    extracted = normalizedText((await mammoth.extractRawText({ buffer })).value);
  } catch {
    throw new DocxError('TEXT_EXTRACTION', 'The generated Word file could not be read by the text extractor.');
  }
  for (const edit of planned.replacements.values()) {
    if (edit.text && !extracted.includes(normalizedText(edit.text))) {
      throw new DocxError('TEXT_EXTRACTION', 'Approved text is missing from the extracted resume.', { editId: edit.id });
    }
  }
  if (!extracted) throw new DocxError('TEXT_EXTRACTION', 'The generated resume has no extractable text.');
  return { output, extracted, applied: [...planned.replacements.values()].map((edit) => edit.id) };
}
