/* Shared by the local Node API and the isolated extension context. */
(() => {
  const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const CONSENT = /\b(agree|acknowledg\w*|consent|certify|certifies|attest|attestation|declare|declaration|affirm|authorize|authorise|have read|have reviewed|i accept|i confirm|i understand|terms and conditions)\b/i;
  const PRIVACY = /\b(privacy (?:policy|notice|statement|information)|data protection notice|applicant privacy)\b/i;
  const MARKETING = /\b(marketing|promot(?:ion|ional)|newsletter|advertis\w*|job alerts|talent (?:community|pool|network)|future opportunit\w*)\b/i;
  const BACKGROUND = /\b(background (?:check|screening|investigation)|consumer report)\b/i;
  const SIGNATURE = /\b(?:(?:electronic|digital|typed|applicant) signature|signature|firma electr[oó]nica|assinatura eletr[oô]nica|unterschrift|type your (?:full )?name to sign)\b/i;
  const PRIVATE = /\b(password|passcode|captcha|social security|ssn|aadhaar|pan card|tax id|government id|passport (?:number|id)|payment|bank account|credit card|verification code|one.time (?:code|password)|otp)\b/i;
  const SENSITIVE = /\b(relocat\w*|sponsor\w*|work authorization|(?:authorized|eligible|legally entitled) to work|work permit|citizen\w*|visa|immigration|(?:expected|current|desired|target|minimum) (?:salary|pay|compensation)|clearance|criminal|conviction\w*|race|ethnicity|disability|disabled|veteran|gender|nationality|at least \d+ years old|government employ\w*|civil service|public sector employment|(?:previously|ever) (?:been )?employed by)\b/i;

  function classify(field) {
    const label = normalize(field.label);
    const local = normalize([label, field.help, field.name, field.placeholder, ...(field.options || [])].filter(Boolean).join(' '));
    const context = normalize(field.terms);
    const choice = /^(?:checkbox|checkbox-group|radio|select|select-multiple|dropdown|switch)$/.test(field.type);
    if (PRIVATE.test(local) || /^(password|otp-split|captcha)$/.test(field.type)) return 'restricted';
    if (SIGNATURE.test(label)) return field.type === 'file' ? 'restricted' : 'signature';
    if (choice && MARKETING.test(local + ' ' + context)) return 'marketing';
    if (choice && BACKGROUND.test(local + ' ' + context)) return 'background';
    if (choice && PRIVACY.test(local + ' ' + context)) {
      return /\b(waiv\w*|arbitrat\w*|release|transfer to third parties|share with partners|sell|terms and conditions)\b/i.test(local + ' ' + context)
        ? 'ambiguous' : 'privacy';
    }
    if (CONSENT.test(local) || (choice && CONSENT.test(context))) return 'legal';
    if (SENSITIVE.test(local)) return 'sensitive';
    if (/^(?:checkbox|switch)$/.test(field.type) && (field.required || /^(?:|check(?:box)?|accept|yes|no|other|select|continue|confirm|on|off)[\s*]*$/i.test(label))) return 'ambiguous';
    return 'ordinary';
  }

  function fieldEvidence(field) {
    return [field.type, !!field.required, normalize(field.label), normalize(field.help),
      normalize(field.terms), field.contextUrl || '', [...(field.links || [])], !!field.incompleteTerms, [...(field.options || [])]];
  }

  const policy = { classify, fieldEvidence, normalize };
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else globalThis.applicationPolicy = policy;
})();
