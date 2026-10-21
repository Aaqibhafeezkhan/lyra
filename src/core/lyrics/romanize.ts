const devanagari = Object.fromEntries([
  ['अ','a'],['आ','a'],['इ','i'],['ई','i'],['उ','u'],['ऊ','u'],['ऋ','ri'],['ए','e'],['ऐ','ai'],['ओ','o'],['औ','au'],
  ['क','ka'],['ख','kha'],['ग','ga'],['घ','gha'],['ङ','nga'],['च','cha'],['छ','chha'],['ज','ja'],['झ','jha'],['ञ','nya'],
  ['ट','ta'],['ठ','tha'],['ड','da'],['ढ','dha'],['ण','na'],['त','ta'],['थ','tha'],['द','da'],['ध','dha'],['न','na'],
  ['प','pa'],['फ','pha'],['ब','ba'],['भ','bha'],['म','ma'],['य','ya'],['र','ra'],['ल','la'],['व','va'],['श','sha'],
  ['ष','sha'],['स','sa'],['ह','ha'],['ळ','la'],['ा','a'],['ि','i'],['ी','i'],['ु','u'],['ू','u'],['ृ','ri'],
  ['े','e'],['ै','ai'],['ो','o'],['ौ','au'],['ं','n'],['ँ','n'],['ः','h'],['ॅ','e'],['ॉ','o'],['्',''],['़','']
]) as Record<string, string>;

const gurmukhi = Object.fromEntries([
  ['ਅ','a'],['ਆ','a'],['ਇ','i'],['ਈ','i'],['ਉ','u'],['ਊ','u'],['ਏ','e'],['ਐ','ai'],['ਓ','o'],['ਔ','au'],
  ['ਕ','ka'],['ਖ','kha'],['ਗ','ga'],['ਘ','gha'],['ਙ','nga'],['ਚ','cha'],['ਛ','chha'],['ਜ','ja'],['ਝ','jha'],['ਞ','nya'],
  ['ਟ','ta'],['ਠ','tha'],['ਡ','da'],['ਢ','dha'],['ਣ','na'],['ਤ','ta'],['ਥ','tha'],['ਦ','da'],['ਧ','dha'],['ਨ','na'],
  ['ਪ','pa'],['ਫ','pha'],['ਬ','ba'],['ਭ','bha'],['ਮ','ma'],['ਯ','ya'],['ਰ','ra'],['ਲ','la'],['ਵ','va'],['ਸ','sa'],['ਹ','ha'],
  ['ੜ','rha'],['ਖ਼','kha'],['ਗ਼','gha'],['ਜ਼','za'],['ਫ਼','fa'],['ਾ','a'],['ਿ','i'],['ੀ','i'],['ੁ','u'],['ੂ','u'],
  ['ੇ','e'],['ੈ','ai'],['ੋ','o'],['ੌ','au'],['ੰ','n'],['ਂ','n'],['ੱ',''],['੍','']
]) as Record<string, string>;

function transliterateScript(text: string, mapping: Record<string, string>, virama: string): string {
  let output = '';
  for (const char of text) {
    if (char === virama) {
      if (output.endsWith('a')) output = output.slice(0, -1);
      continue;
    }
    const mapped = mapping[char];
    if (mapped !== undefined) {
      if ('ािीुूृेैोौॅॉਾਿੀੁੂੇੈੋੌ'.includes(char) && output.endsWith('a')) output = output.slice(0, -1);
      output += mapped;
    } else {
      output += char;
    }
  }
  return output.replace(/a(?=[\s.,!?;:।॥\n]|$)/g, '');
}

/** Offline transliteration for Hindi in Devanagari and Punjabi in Gurmukhi; this does not translate meaning. */
export function romanizeLyrics(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return transliterateScript(text, devanagari, '्');
  if (/[\u0A00-\u0A7F]/.test(text)) return transliterateScript(text, gurmukhi, '੍');
  return text;
}
