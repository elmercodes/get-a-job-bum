import path from 'node:path';
import yauzl from 'yauzl';

const MAX_EXPANDED = 35 * 1024 * 1024;
const PDF_SIGNATURE = Buffer.from('%PDF-');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPG_SIGNATURE = Buffer.from([255, 216, 255]);
const hasPrefix = (buffer, signature) => buffer.subarray(0, signature.length).equals(signature);

export class UploadError extends Error {}

function validateDocx(buffer) {
  return new Promise((resolve, reject) => {
    const invalid = () => reject(new UploadError('Invalid or unsupported DOCX archive'));
    yauzl.fromBuffer(buffer, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error) return invalid();
      const fail = () => { zip.close(); invalid(); };
      const parts = new Set();
      let expanded = 0;
      zip.on('error', fail);
      zip.on('end', () => {
        zip.close();
        if (!parts.has('[Content_Types].xml') || !parts.has('word/document.xml')) return invalid();
        resolve();
      });
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        expanded += entry.uncompressedSize;
        if (parts.has(name) || expanded > MAX_EXPANDED ||
            entry.isEncrypted() || /(?:^|\/)(?:embeddings\/|activex\/)|vbaProject\.bin$/i.test(name)) return fail();
        parts.add(name);
        if (!/\.(?:xml|rels)$/i.test(name)) return zip.readEntry();
        if (entry.uncompressedSize > 4 * 1024 * 1024) return fail();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail();
          const chunks = [];
          stream.on('error', fail);
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            const xml = Buffer.concat(chunks).toString('utf8');
            // Reject declarations and non-UTF-8 parts before forwarding the archive to the parser.
            if (/[\x00\uFFFD]|<!DOCTYPE|<!ENTITY/i.test(xml)) return fail();
            // Ordinary hyperlinks are retained as text. Other external parts can trigger document resolution.
            if (/\.rels$/i.test(name) && (xml.match(/<Relationship\b[^>]*>/gi) || []).some((tag) =>
              /\bTargetMode\s*=\s*["']External["']/i.test(tag) &&
              !/\bType\s*=\s*["'][^"']*\/hyperlink["']/i.test(tag))) return fail();
            zip.readEntry();
          });
        });
      });
      if (zip.entryCount > 512) return fail();
      zip.readEntry();
    });
  });
}

export async function validateUpload(file, { resume = false } = {}) {
  if (!file?.buffer?.length) throw new UploadError('Choose a nonempty file');
  const { buffer } = file;
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.pdf' && hasPrefix(buffer, PDF_SIGNATURE) &&
      /%%EOF\s*$/.test(buffer.subarray(-1024).toString('latin1')) &&
      !/\/(?:JavaScript|JS|Launch|OpenAction|EmbeddedFile)\b/.test(buffer.toString('latin1'))) return;
  if (resume && ext === '.docx') return validateDocx(buffer);
  if (resume && ext === '.txt' && !/[\x00\uFFFD]/.test(buffer.toString('utf8'))) return;
  if (!resume && ext === '.png' && hasPrefix(buffer, PNG_SIGNATURE) && buffer.subarray(-8, -4).toString() === 'IEND') return;
  if (!resume && ['.jpg', '.jpeg'].includes(ext) && hasPrefix(buffer, JPG_SIGNATURE) && buffer.subarray(-2).equals(Buffer.from([255, 217]))) return;
  throw new UploadError(resume ? 'Choose a valid PDF, DOCX or UTF-8 TXT file' : 'Choose a valid PDF, PNG or JPEG file');
}
