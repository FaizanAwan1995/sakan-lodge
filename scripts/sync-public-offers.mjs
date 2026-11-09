import {readFile, writeFile} from 'node:fs/promises';
import {renderPublicRates, COUPLES_FAQ} from '../src/public-offers.js';
const path = new URL('../public/landing.html', import.meta.url);
const source = await readFile(path, 'utf8');
const rates = /<section class="section rates-section"[\s\S]*?<\/section>/;
const faq = /(<summary>Can couples enquire about accommodation\?<\/summary><p>)[\s\S]*?(<\/p>)/;
if (!rates.test(source) || !faq.test(source)) throw new Error('Public offer template markers are missing');
const updated = source.replace(rates, () => renderPublicRates()).replace(faq, (_, start, end) => start + COUPLES_FAQ + end);
if (updated !== source) await writeFile(path, updated);
