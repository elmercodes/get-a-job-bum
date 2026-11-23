// Adapted from Application Assistant utils/profile-extraction.ts.
// MIT, copyright (c) 2026 Application Assistant contributors.
// Pinned e795a42bfe058c65f1530bbf68c9a1f09dea7f1d. See NOTICE.md.

const ALL_KEYS = [
    'firstName', 'lastName', 'fullName', 'email', 'phone', 'addressLine1',
    'addressLine2', 'city', 'state', 'country', 'postalCode', 'linkedin',
    'github', 'portfolio', 'currentCompany', 'currentTitle',
];
const SECTION_HEADINGS = new Set([
    'summary', 'professional summary', 'profile', 'experience',
    'professional experience', 'work experience', 'employment',
    'employment history', 'education', 'skills', 'technical skills',
    'projects', 'selected projects', 'research', 'research experience',
    'publications', 'selected publications', 'awards', 'honors',
    'certifications', 'leadership', 'leadership experience',
]);
const EXPERIENCE_HEADINGS = new Set([
    'experience', 'professional experience', 'work experience', 'employment',
    'employment history', 'research experience',
]);
const EDUCATION_HEADINGS = new Set(['education', 'academic background']);
const SKILL_HEADINGS = new Set(['skills', 'technical skills', 'technologies']);
const US_STATE_NAMES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
    KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
    MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
    NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
    OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
    VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
    DC: 'District of Columbia',
};
const MONTH = '(?:Jan(?:uary)?\.?|Feb(?:ruary)?\.?|Mar(?:ch)?\.?|Apr(?:il)?\.?|May\.?|Jun(?:e)?\.?|Jul(?:y)?\.?|Aug(?:ust)?\.?|Sep(?:t(?:ember)?)?\.?|Oct(?:ober)?\.?|Nov(?:ember)?\.?|Dec(?:ember)?\.?)';
const DATE_TOKEN = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}`;
const DATE_RANGE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to)\\s*(Present|Current|${DATE_TOKEN})`, 'i');
function normalizeLine(value) {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, '-')
        .replace(/[\u2022\u2023\u2043\u25aa\u25cf\u25e6]/g, '•')
        .replace(/[ ]*\t+[ ]*/g, '\t')
        .replace(/[ ]+/g, ' ')
        .trim();
}
function normalizedHeading(value) {
    return normalizeLine(value).replace(/:$/, '').toLocaleLowerCase();
}
function isHeading(value) {
    const normalized = normalizedHeading(value);
    if (SECTION_HEADINGS.has(normalized))
        return true;
    const letters = value.replace(/[^A-Za-z]/g, '');
    const words = value.split(/\s+/).filter(Boolean);
    return Boolean(letters.length >= 3 && value.length <= 48 && words.length <= 7 && value === value.toUpperCase());
}
function linesWithBreaks(rawText) {
    const source = rawText.replace(/\r/g, '').split('\n');
    const output = [];
    for (const raw of source) {
        const line = normalizeLine(raw);
        if (!line) {
            if (output.length > 0 && output[output.length - 1] !== '')
                output.push('');
            continue;
        }
        output.push(line);
    }
    return output;
}
function firstMatch(lines, pattern) {
    for (const line of lines) {
        const match = line.match(pattern);
        if (match?.[0])
            return { value: match[0].trim(), source: line };
    }
    return null;
}
function addCandidate(candidates, key, value, confidence, sourceQuote, reason) {
    const cleaned = value.trim();
    if (!cleaned)
        return;
    if (candidates.some((candidate) => candidate.key === key))
        return;
    candidates.push({ key, value: cleaned, confidence, sourceQuote: sourceQuote.trim(), reason });
}
function splitName(fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length <= 1)
        return { firstName: parts[0] ?? '', lastName: '' };
    return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}
function findName(lines) {
    for (const line of lines.slice(0, 10)) {
        if (!line || isHeading(line))
            continue;
        if (/@|https?:\/\/|linkedin|github|\d{3}[-(). ]\d/i.test(line))
            continue;
        if (line.length < 3 || line.length > 70)
            continue;
        const words = line.split(/\s+/).filter(Boolean);
        if (words.length < 2 || words.length > 6)
            continue;
        if (words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word)))
            return { value: line, source: line };
    }
    return null;
}
function parseLocationLine(line) {
    const stateAlternation = [
        ...Object.keys(US_STATE_NAMES),
        ...Object.values(US_STATE_NAMES).map((name) => name.replace(/ /g, '\\s+')),
    ].join('|');
    const pattern = new RegExp(`(?:^|[|·;])\\s*([A-Za-z .'-]{2,50}),\\s*(${stateAlternation})(?:\\s+(\\d{5}(?:-\\d{4})?))?(?:$|[|·;])`, 'i');
    const match = line.match(pattern);
    if (!match)
        return null;
    const rawState = (match[2] ?? '').trim();
    const code = Object.entries(US_STATE_NAMES).find(([abbr, name]) => abbr.toLocaleLowerCase() === rawState.toLocaleLowerCase() ||
        name.toLocaleLowerCase() === rawState.toLocaleLowerCase())?.[0] ?? rawState;
    return {
        city: (match[1] ?? '').trim(),
        state: code.toUpperCase(),
        postalCode: (match[3] ?? '').trim(),
        source: line,
    };
}
function looksLikeStreet(line) {
    return /^\d{1,6}\s+[A-Za-z0-9 .'-]{3,80}\b(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Parkway|Pkwy|Circle|Cir)\b(?:[ .,#A-Za-z0-9-]*)$/i.test(line);
}
function sectionBounds(lines, headings) {
    const start = lines.findIndex((line) => headings.has(normalizedHeading(line)));
    if (start < 0)
        return null;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line && isHeading(line)) {
            end = index;
            break;
        }
    }
    return { start: start + 1, end };
}
function isBulletLine(line) {
    return /^[•*-]\s+/.test(line);
}
function stripBullet(line) {
    return line.replace(/^[•*-]\s+/, '').trim();
}
function stripDateRange(line) {
    return normalizeLine(line.replace(DATE_RANGE, '').replace(/^[\t |·-]+|[\t |·-]+$/g, ''));
}
function splitHeaderSegments(line) {
    return line
        .split(/\t+|\s+(?:\||·|—|–)\s+|\s{2,}/)
        .map(normalizeLine)
        .filter(Boolean);
}
function dateAnchoredBlocks(sectionLines) {
    const lines = sectionLines.filter(Boolean);
    const dateIndexes = lines
        .map((line, index) => DATE_RANGE.test(line) ? index : -1)
        .filter((index) => index >= 0);
    if (dateIndexes.length === 0)
        return splitBlankBlocks(sectionLines);
    const starts = dateIndexes.map((dateIndex) => {
        const left = stripDateRange(lines[dateIndex] ?? '');
        if (left)
            return dateIndex;
        const previous = lines[dateIndex - 1] ?? '';
        if (previous && !isBulletLine(previous) && !isHeading(previous))
            return dateIndex - 1;
        return dateIndex;
    });
    const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
    return uniqueStarts.map((start, index) => {
        const end = uniqueStarts[index + 1] ?? lines.length;
        return lines.slice(start, end).filter(Boolean);
    }).filter((block) => block.length > 0);
}
function educationDateAnchoredBlocks(sectionLines) {
    const lines = sectionLines.filter(Boolean);
    const starts = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!DATE_RANGE.test(lines[index] ?? ''))
            continue;
        const previous = lines[index - 1] ?? '';
        const start = previous && /\b(university|college|institute|school)\b/i.test(previous)
            ? index - 1
            : index;
        starts.push(start);
    }
    if (starts.length === 0)
        return splitBlankBlocks(sectionLines);
    const uniqueStarts = [...new Set(starts)].sort((a, b) => a - b);
    return uniqueStarts.map((start, index) => {
        const end = uniqueStarts[index + 1] ?? lines.length;
        return lines.slice(start, end).filter(Boolean);
    }).filter((block) => block.length > 0);
}
function splitBlankBlocks(sectionLines) {
    const blocks = [];
    let current = [];
    const flush = () => {
        if (current.length > 0)
            blocks.push(current);
        current = [];
    };
    for (const line of sectionLines) {
        if (!line) {
            flush();
            continue;
        }
        current.push(line);
    }
    flush();
    return blocks;
}
function parseDateRange(lines) {
    for (let index = 0; index < lines.length; index += 1) {
        const match = (lines[index] ?? '').match(DATE_RANGE);
        if (match)
            return { startDate: match[1] ?? '', endDate: match[2] ?? '', lineIndex: index };
    }
    return { startDate: '', endDate: '', lineIndex: -1 };
}
function titleScore(line) {
    return /\b(engineer|scientist|researcher|developer|intern|manager|analyst|professor|fellow|assistant|consultant|lead|director|architect|specialist|postdoc|postdoctoral|doctoral|phd candidate|scholar|volunteer|mentor|organizer|coordinator|tutor|chair|board member|ambassador|coach|facilitator|treasurer|secretary|president|vice president)\b/i.test(line) ? 2 : 0;
}
function companyScore(line) {
    return /\b(university|institute|laborator(?:y|ies)|labs?|inc\.?|llc|corp\.?|corporation|company|bank|capital|technologies|technology|systems|research|school|college|center|centre|foundation|group|association|society|charity|council|chapter|community|network|alliance|club|nonprofit)\b/i.test(line) ? 2 : 0;
}
const ORGANIZATION_ENDING = /\b(?:university|institute|laborator(?:y|ies)|labs?|inc\.?|llc|corp\.?|corporation|company|bank|capital|technologies|technology|systems|research|school|college|center|centre|foundation|group|association|society|charity|council|chapter|community|network|alliance|club|nonprofit)(?:\s*\([^)]*\))?$/i;
const COUNTRY_OR_REGION = /^(?:united states(?: of america)?|usa|u\.?s\.?a?\.?|china|hong kong|canada|singapore|australia|india|united kingdom|uk|germany|france|japan|south korea)$/i;
function splitOrganizationLocation(line) {
    const cleaned = normalizeLine(line);
    if (!cleaned)
        return { organization: '', location: '' };
    const simpleSuffixes = ['Remote', 'Hybrid', 'Onsite', 'On-site', 'Hong Kong', 'Singapore'];
    for (const suffix of simpleSuffixes) {
        if (cleaned.toLocaleLowerCase() === suffix.toLocaleLowerCase()) {
            return { organization: '', location: suffix };
        }
        if (cleaned.toLocaleLowerCase().endsWith(` ${suffix.toLocaleLowerCase()}`)) {
            const organization = cleaned.slice(0, cleaned.length - suffix.length).trim();
            if (companyScore(organization) > 0)
                return { organization, location: suffix };
        }
    }
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    let best = null;
    for (let locationWords = 2; locationWords <= Math.min(5, tokens.length - 1); locationWords += 1) {
        const splitIndex = tokens.length - locationWords;
        const organization = tokens.slice(0, splitIndex).join(' ');
        const location = tokens.slice(splitIndex).join(' ');
        if (!organization || companyScore(organization) === 0)
            continue;
        const parsedUs = parseLocationLine(location);
        const countryMatch = location.match(/^([A-Za-z .'-]{2,45}),\s*([A-Za-z .'-]{2,35})$/);
        const countryCity = countryMatch?.[1]?.trim() ?? '';
        const countryName = countryMatch?.[2]?.trim() ?? '';
        const validCountryLocation = Boolean(countryMatch &&
            !/^(?:of|and|the)\b/i.test(countryCity) &&
            !countryCity.toLocaleLowerCase().startsWith(`${countryName.toLocaleLowerCase()} `) &&
            !/(?:\bof|\band|\bthe)$/i.test(organization) &&
            COUNTRY_OR_REGION.test(countryName));
        if (!parsedUs && !validCountryLocation)
            continue;
        if (companyScore(location) > 0)
            continue;
        let score = 10;
        if (ORGANIZATION_ENDING.test(organization))
            score += 8;
        if (parsedUs)
            score += 4;
        if (locationWords >= 3)
            score += 1;
        if (!best || score > best.score)
            best = { organization, location, score };
    }
    return best ? { organization: best.organization, location: best.location } : { organization: cleaned, location: '' };
}
function locationFromSegments(lines) {
    for (const line of lines) {
        const split = splitOrganizationLocation(line);
        if (split.location)
            return split.location;
        const segments = splitHeaderSegments(line);
        for (const segment of [...segments].reverse()) {
            const parsed = parseLocationLine(segment);
            if (parsed)
                return [parsed.city, parsed.state].filter(Boolean).join(', ');
            if (/^(?:remote|hybrid|on-?site|[A-Za-z .'-]+,\s*[A-Za-z .'-]+)$/i.test(segment) && titleScore(segment) === 0 && companyScore(segment) === 0) {
                return segment;
            }
            if (segments.length >= 2 && segment === segments[segments.length - 1] && /^[A-Za-z .'-]{2,40}$/.test(segment) && titleScore(segment) === 0 && companyScore(segment) === 0) {
                return segment;
            }
        }
    }
    return '';
}
function collectDescriptions(block, firstBulletIndex) {
    const descriptions = [];
    let current = '';
    const flush = () => {
        const cleaned = current.replace(/[\t ]+/g, ' ').trim();
        if (cleaned)
            descriptions.push(cleaned);
        current = '';
    };
    if (firstBulletIndex >= 0) {
        for (const line of block.slice(firstBulletIndex)) {
            if (isBulletLine(line)) {
                flush();
                current = stripBullet(line);
            }
            else if (current) {
                current += ` ${line}`;
            }
        }
        flush();
        return descriptions;
    }
    for (const line of block) {
        if (DATE_RANGE.test(line) || parseLocationLine(line))
            continue;
        if (titleScore(line) > 0 || companyScore(line) > 0)
            continue;
        if (line.length >= 55)
            descriptions.push(line);
    }
    return descriptions;
}
function parseExperienceBlock(block) {
    if (block.length === 0)
        return null;
    const date = parseDateRange(block);
    const dateLine = date.lineIndex >= 0 ? block[date.lineIndex] ?? '' : '';
    const dateLeft = stripDateRange(dateLine);
    const firstBulletIndex = block.findIndex(isBulletLine);
    const headerLimit = firstBulletIndex >= 0 ? firstBulletIndex : Math.min(block.length, 6);
    const headerLines = block.slice(0, headerLimit);
    const headerSegments = headerLines.flatMap((line) => splitHeaderSegments(stripDateRange(line)));
    let title = dateLeft && titleScore(dateLeft) >= companyScore(dateLeft) ? dateLeft : '';
    if (!title)
        title = headerSegments.find((segment) => titleScore(segment) > companyScore(segment)) ?? '';
    let company = headerSegments.find((segment) => segment !== title && companyScore(segment) >= titleScore(segment)) ?? '';
    if (!title) {
        title = headerSegments.find((segment) => !parseLocationLine(segment) && !/^(?:remote|hybrid|on-?site)$/i.test(segment)) ?? '';
    }
    if (!company) {
        company = headerSegments.find((segment) => segment !== title && !parseLocationLine(segment) && !/^(?:remote|hybrid|on-?site)$/i.test(segment)) ?? '';
    }
    const companyAndLocation = splitOrganizationLocation(company);
    company = companyAndLocation.organization || company;
    const descriptions = collectDescriptions(block, firstBulletIndex);
    if (!title && !company && descriptions.length === 0)
        return null;
    const confidence = Math.min(0.98, 0.48 + (title ? 0.17 : 0) + (company ? 0.17 : 0) + (date.startDate ? 0.11 : 0) + (descriptions.length ? 0.05 : 0));
    return {
        company,
        title,
        location: companyAndLocation.location || locationFromSegments(headerLines),
        startDate: date.startDate,
        endDate: date.endDate,
        bullets: descriptions,
        sourceText: block.join('\n'),
        confidence,
    };
}
function parseExperiences(lines) {
    const bounds = sectionBounds(lines, EXPERIENCE_HEADINGS);
    if (!bounds)
        return [];
    return dateAnchoredBlocks(lines.slice(bounds.start, bounds.end))
        .map(parseExperienceBlock)
        .filter((entry) => Boolean(entry))
        .slice(0, 15);
}
function parseEducationBlock(block) {
    if (block.length === 0)
        return null;
    const date = parseDateRange(block);
    const dateLine = date.lineIndex >= 0 ? block[date.lineIndex] ?? '' : '';
    const dateLeft = stripDateRange(dateLine);
    const segments = block.flatMap((line) => splitHeaderSegments(stripDateRange(line)));
    const institutionLine = segments.find((line) => /\b(university|college|institute|school)\b/i.test(line)) ?? '';
    const institutionAndLocation = splitOrganizationLocation(institutionLine);
    const institution = institutionAndLocation.organization || institutionLine;
    const degree = (dateLeft && /\b(ph\.?d\.?|doctor|master|m\.?s\.?|m\.?eng\.?|bachelor|b\.?s\.?|b\.?e\.?|b\.?eng\.?|mba|degree)\b/i.test(dateLeft))
        ? dateLeft
        : segments.find((line) => /\b(ph\.?d\.?|doctor|master|m\.?s\.?|m\.?eng\.?|bachelor|b\.?s\.?|b\.?e\.?|b\.?eng\.?|mba|degree)\b/i.test(line)) ?? '';
    const gpa = block.map((line) => line.match(/\bGPA\s*[: ]\s*([0-4](?:\.\d{1,2})?)(?:\s*\/\s*4(?:\.0)?)?/i)?.[1]).find(Boolean) ?? '';
    const fieldMatch = degree.match(/(?:in|of)\s+([A-Za-z][A-Za-z &/()\-]{2,100})/i);
    if (!degree && !institution)
        return null;
    const confidence = Math.min(0.97, 0.52 + (degree ? 0.18 : 0) + (institution ? 0.18 : 0) + (date.endDate ? 0.06 : 0));
    return {
        institution,
        degree,
        field: fieldMatch?.[1]?.trim() ?? '',
        location: institutionAndLocation.location || locationFromSegments(block.slice(0, 4)),
        startDate: date.startDate,
        endDate: date.endDate,
        gpa,
        sourceText: block.join('\n'),
        confidence,
    };
}
function parseEducation(lines) {
    const bounds = sectionBounds(lines, EDUCATION_HEADINGS);
    if (!bounds)
        return [];
    return educationDateAnchoredBlocks(lines.slice(bounds.start, bounds.end))
        .map(parseEducationBlock)
        .filter((entry) => Boolean(entry))
        .slice(0, 10);
}
function normalizeSkill(value) {
    return value
        .replace(/^[-*•]\s*/, '')
        .replace(/\s*\((?:primary|advanced|intermediate|basic)\)\s*/ig, '')
        .replace(/[\t ]+/g, ' ')
        .replace(/[.;]+$/, '')
        .trim();
}
function parseSkills(lines) {
    const bounds = sectionBounds(lines, SKILL_HEADINGS);
    if (!bounds)
        return [];
    const sectionLines = lines.slice(bounds.start, bounds.end).filter(Boolean);
    const logicalLines = [];
    for (const line of sectionLines) {
        if (/^[A-Za-z][A-Za-z /&-]{1,40}:/.test(line) || logicalLines.length === 0)
            logicalLines.push(line);
        else
            logicalLines[logicalLines.length - 1] = `${logicalLines[logicalLines.length - 1]} ${line}`;
    }
    const output = [];
    const seen = new Set();
    for (const line of logicalLines) {
        const body = line.replace(/^[A-Za-z][A-Za-z /&-]{1,40}:\s*/, '');
        for (const raw of body.split(/[,;]|\t+/)) {
            const skill = normalizeSkill(raw);
            if (skill.length < 1 || skill.length > 70)
                continue;
            const key = skill.toLocaleLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            output.push(skill);
        }
    }
    return output.slice(0, 80);
}
export function extractResumeProfile(rawText) {
    const lines = linesWithBreaks(rawText);
    const nonBlank = lines.filter(Boolean);
    const candidates = [];
    const name = findName(nonBlank);
    if (name) {
        addCandidate(candidates, 'fullName', name.value, 0.86, name.source, 'Likely name in the CV header');
        const split = splitName(name.value);
        addCandidate(candidates, 'firstName', split.firstName, 0.78, name.source, 'Derived from likely full name');
        addCandidate(candidates, 'lastName', split.lastName, 0.72, name.source, 'Derived from likely full name');
    }
    const email = firstMatch(nonBlank.slice(0, 30), /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email)
        addCandidate(candidates, 'email', email.value, 0.99, email.source, 'Email pattern in CV header');
    const phone = firstMatch(nonBlank.slice(0, 30), /(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}/);
    if (phone)
        addCandidate(candidates, 'phone', phone.value, 0.96, phone.source, 'North American phone-number pattern');
    for (const line of nonBlank.slice(0, 35)) {
        const linkedin = line.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_%./-]+/i)?.[0];
        if (linkedin)
            addCandidate(candidates, 'linkedin', linkedin.startsWith('http') ? linkedin : `https://${linkedin}`, 0.98, line, 'LinkedIn URL');
        const github = line.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_.-]+/i)?.[0];
        if (github)
            addCandidate(candidates, 'github', github.startsWith('http') ? github : `https://${github}`, 0.98, line, 'GitHub URL');
        const urls = line.match(/https?:\/\/[^\s|]+/gi) ?? [];
        const portfolio = urls.find((url) => !/linkedin\.com|github\.com/i.test(url));
        if (portfolio)
            addCandidate(candidates, 'portfolio', portfolio, 0.78, line, 'Non-LinkedIn/GitHub website in CV header');
    }
    for (let index = 0; index < Math.min(nonBlank.length, 35); index += 1) {
        const line = nonBlank[index] ?? '';
        const location = parseLocationLine(line);
        if (!location)
            continue;
        addCandidate(candidates, 'city', location.city, 0.88, line, 'City/state pattern in CV header');
        addCandidate(candidates, 'state', location.state, 0.9, line, 'U.S. state in CV header');
        if (location.postalCode)
            addCandidate(candidates, 'postalCode', location.postalCode, 0.94, line, 'Postal-code pattern');
        const previous = nonBlank[index - 1] ?? '';
        if (looksLikeStreet(previous))
            addCandidate(candidates, 'addressLine1', previous, 0.84, previous, 'Street-address pattern before city/state');
        break;
    }
    const structured = {
        experiences: parseExperiences(lines),
        education: parseEducation(lines),
        skills: parseSkills(lines),
    };
    const current = structured.experiences.find((experience) => /\b(?:present|current|ongoing)\b/i.test(`${experience.endDate} ${experience.sourceText}`));
    if (current) {
        if (current.company)
            addCandidate(candidates, 'currentCompany', current.company, Math.min(0.84, current.confidence), current.sourceText, 'Explicit current experience entry');
        if (current.title)
            addCandidate(candidates, 'currentTitle', current.title, Math.min(0.84, current.confidence), current.sourceText, 'Explicit current experience entry');
    }
    const explicitCountryLine = nonBlank.slice(0, 35).find((line) => /^(?:united states(?: of america)?|u\.?s\.?a?\.?)$/i.test(line));
    if (explicitCountryLine) {
        addCandidate(candidates, 'country', 'United States', 0.98, explicitCountryLine, 'Explicit country in CV header');
    }
    return {
        candidates,
        structured,
        missing: ALL_KEYS.filter((key) => !candidates.some((candidate) => candidate.key === key)),
    };
}
