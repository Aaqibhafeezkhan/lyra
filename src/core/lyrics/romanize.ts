/**
 * Offline transliteration of Hindi (Devanagari) and Punjabi (Gurmukhi) lyrics into Roman letters, the way people
 * write them in chats ("tera", "meri", "zindagi"): it reads out the sounds, it does not translate.
 *
 * A word is split into syllables (a consonant plus the vowel it carries). A consonant that carries no vowel sign has
 * the inherent "a", which Hindi/Punjabi speakers do not pronounce at the end of a word ("raam" -> "ram") or between
 * two syllables that already have a vowel ("ladki" -> "larki", not "ladaki"); both cases are handled.
 */

type Kind = 'consonant' | 'vowel' | 'matra' | 'nasal' | 'visarga' | 'virama' | 'nukta' | 'addak'
interface Entry {
  kind: Kind
  roman: string
}

const E = (kind: Kind, roman: string): Entry => ({ kind, roman })
const table: Record<string, Entry> = {}
function add(kind: Kind, pairs: string[]): void {
  for (let i = 0; i < pairs.length; i += 2) table[pairs[i]!] = E(kind, pairs[i + 1]!)
}

// ---- Devanagari (Hindi)
add('vowel', ['अ', 'a', 'आ', 'a', 'इ', 'i', 'ई', 'i', 'उ', 'u', 'ऊ', 'u', 'ऋ', 'ri', 'ए', 'e', 'ऐ', 'ai', 'ओ', 'o', 'औ', 'au', 'ऑ', 'o'])
add('consonant', [
  'क', 'k', 'ख', 'kh', 'ग', 'g', 'घ', 'gh', 'ङ', 'ng', 'च', 'ch', 'छ', 'chh', 'ज', 'j', 'झ', 'jh', 'ञ', 'ny',
  'ट', 't', 'ठ', 'th', 'ड', 'd', 'ढ', 'dh', 'ण', 'n', 'त', 't', 'थ', 'th', 'द', 'd', 'ध', 'dh', 'न', 'n',
  'प', 'p', 'फ', 'ph', 'ब', 'b', 'भ', 'bh', 'म', 'm', 'य', 'y', 'र', 'r', 'ल', 'l', 'व', 'v', 'श', 'sh', 'ष', 'sh', 'स', 's', 'ह', 'h', 'ळ', 'l',
  // precomposed nukta letters
  'ड़', 'r', 'ढ़', 'rh', 'ज़', 'z', 'फ़', 'f', 'क़', 'q', 'ख़', 'kh', 'ग़', 'g'
])
add('matra', ['ा', 'a', 'ि', 'i', 'ी', 'i', 'ु', 'u', 'ू', 'u', 'ृ', 'ri', 'े', 'e', 'ै', 'ai', 'ो', 'o', 'ौ', 'au', 'ॅ', 'e', 'ॉ', 'o'])
add('nasal', ['ं', 'n', 'ँ', 'n'])
add('visarga', ['ः', 'h'])
add('virama', ['्', ''])
add('nukta', ['़', ''])

// ---- Gurmukhi (Punjabi)
add('vowel', ['ਅ', 'a', 'ਆ', 'a', 'ਇ', 'i', 'ਈ', 'i', 'ਉ', 'u', 'ਊ', 'u', 'ਏ', 'e', 'ਐ', 'ai', 'ਓ', 'o', 'ਔ', 'au', 'ੲ', 'i', 'ੳ', 'u'])
add('consonant', [
  'ਕ', 'k', 'ਖ', 'kh', 'ਗ', 'g', 'ਘ', 'gh', 'ਙ', 'ng', 'ਚ', 'ch', 'ਛ', 'chh', 'ਜ', 'j', 'ਝ', 'jh', 'ਞ', 'ny',
  'ਟ', 't', 'ਠ', 'th', 'ਡ', 'd', 'ਢ', 'dh', 'ਣ', 'n', 'ਤ', 't', 'ਥ', 'th', 'ਦ', 'd', 'ਧ', 'dh', 'ਨ', 'n',
  'ਪ', 'p', 'ਫ', 'ph', 'ਬ', 'b', 'ਭ', 'bh', 'ਮ', 'm', 'ਯ', 'y', 'ਰ', 'r', 'ਲ', 'l', 'ਵ', 'v', 'ੜ', 'r', 'ਸ', 's', 'ਹ', 'h',
  'ਸ਼', 'sh', 'ਖ਼', 'kh', 'ਗ਼', 'g', 'ਜ਼', 'z', 'ਫ਼', 'f', 'ਲ਼', 'l'
])
add('matra', ['ਾ', 'a', 'ਿ', 'i', 'ੀ', 'i', 'ੁ', 'u', 'ੂ', 'u', 'ੇ', 'e', 'ੈ', 'ai', 'ੋ', 'o', 'ੌ', 'au'])
add('nasal', ['ੰ', 'n', 'ਂ', 'n'])
add('visarga', ['ਃ', 'h'])
add('virama', ['੍', ''])
add('nukta', ['਼', ''])
add('addak', ['ੱ', ''])

/** what a plain consonant becomes when a nukta (the dot below) follows it */
const NUKTA: Record<string, string> = { j: 'z', ph: 'f', d: 'r', dh: 'rh', k: 'q' }

interface Syllable {
  c: string // consonant sounds ('' for a vowel that stands alone)
  v: string // vowel written ('' = none yet)
  dead: boolean // killed by a virama: no vowel at all
  tail: string // nasal / visarga after the vowel
  double: boolean // an addak doubles the consonant
}

function renderWord(syls: Syllable[]): string {
  const n = syls.length
  const keep: boolean[] = new Array(n).fill(true) // does the inherent "a" of syllable i stay?
  const inherent = (s: Syllable): boolean => s.c !== '' && s.v === '' && !s.dead
  // right to left, so each decision sees the final state of the syllable after it
  const hasVowel = (i: number): boolean => i >= 0 && i < n && (!!syls[i]!.v || (inherent(syls[i]!) && keep[i]!))
  for (let i = n - 1; i >= 0; i--) {
    const s = syls[i]!
    if (!inherent(s)) continue
    if (i === n - 1) keep[i] = s.tail !== '' // a word-final consonant is not followed by "a" (ram, not rama)
    else if (i > 0 && syls[i - 1]!.tail === '' && hasVowel(i - 1) && hasVowel(i + 1)) keep[i] = false // ladki -> larki
  }
  let out = ''
  for (let i = 0; i < n; i++) {
    const s = syls[i]!
    out += s.double ? s.c + s.c : s.c
    out += inherent(s) ? (keep[i] ? 'a' : '') : s.v
    out += s.tail
  }
  return out
}

/** Roman letters for Hindi (Devanagari) and Punjabi (Gurmukhi) text; everything else is left as it is. */
export function romanizeLyrics(text: string): string {
  if (!/[ऀ-ॿ਀-੿]/.test(text)) return text
  let out = ''
  let word: Syllable[] = []
  let addak = false
  const flush = (): void => {
    if (word.length) out += renderWord(word)
    word = []
  }
  const chars = [...text]
  for (let k = 0; k < chars.length; k++) {
    let ch = chars[k]!
    // letters written as base + combining dot below (ਸ + ਼): join them so the table can find them
    const next = chars[k + 1]
    if (next && table[ch + next] && table[next]?.kind === 'nukta') {
      ch = ch + next
      k++
    }
    const e = table[ch]
    if (!e) {
      flush()
      out += ch
      continue
    }
    const last = word[word.length - 1]
    switch (e.kind) {
      case 'consonant':
        word.push({ c: e.roman, v: '', dead: false, tail: '', double: addak })
        addak = false
        break
      case 'vowel':
        word.push({ c: '', v: e.roman, dead: false, tail: '', double: false })
        break
      case 'matra':
        if (last && last.c !== '' && last.v === '') last.v = e.roman
        else word.push({ c: '', v: e.roman, dead: false, tail: '', double: false })
        break
      case 'nasal':
      case 'visarga':
        if (last) last.tail += e.roman
        else out += e.roman
        break
      case 'virama':
        if (last && last.v === '') last.dead = true
        break
      case 'nukta':
        if (last && last.c !== '') last.c = NUKTA[last.c] ?? last.c
        break
      case 'addak':
        addak = true
        break
    }
  }
  flush()
  return out
}
