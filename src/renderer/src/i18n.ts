import { useEffect, useState } from 'react'

export type Language = 'en' | 'hi'

const STORAGE_KEY = 'lyra.language'

const translations: Record<Language, Record<string, string>> = {
  en: {},
  hi: {
    'Phone': 'फ़ोन',
    'Lyrics': 'गीत के बोल',
    'Look': 'रूप',
    'Background': 'पृष्ठभूमि',
    'Share': 'शेयर',
    'About': 'परिचय',
    'General': 'सामान्य',
    'Shortcuts': 'शॉर्टकट',
    'Settings sections': 'सेटिंग अनुभाग',
    'Language': 'भाषा',
    'Choose the language used in Lyra settings': 'Lyra की सेटिंग के लिए भाषा चुनें',
    'Music source': 'संगीत स्रोत',
    'Rooms: listen together': 'रूम: साथ में सुनें',
    'Host a room': 'रूम शुरू करें',
    'Share a link: friends open it in any browser and see your synced lyrics live. Friends with Lyra can also join to listen in sync with you': 'लिंक साझा करें: दोस्त किसी भी ब्राउज़र में आपके साथ सिंक हुए बोल देख सकते हैं। Lyra वाले दोस्त साथ में सुनने के लिए जुड़ भी सकते हैं।',
    'Start a room': 'रूम शुरू करें',
    'Stop room': 'रूम बंद करें',
    'Opening the room…': 'रूम खुल रहा है…',
    'Room': 'रूम',
    'person': 'व्यक्ति',
    'people': 'लोग',
    'watching. Guests connect straight to this device, so they can see its network address. Stop the room any time.': 'देख रहे हैं। मेहमान सीधे इस डिवाइस से जुड़ते हैं और इसका नेटवर्क पता देख सकते हैं। आप कभी भी रूम बंद कर सकते हैं।',
    'Room link': 'रूम लिंक',
    'Copy link': 'लिंक कॉपी करें',
    'Join a room': 'रूम से जुड़ें',
    'Paste a room link or code. Everyone plays the same song in their own Spotify; Lyra keeps your play, pause and position in step with the host': 'रूम का लिंक या कोड डालें। हर कोई अपने Spotify में वही गाना चलाता है; Lyra प्ले, पॉज़ और गाने की स्थिति को होस्ट के साथ सिंक रखता है।',
    'Leave room': 'रूम छोड़ें',
    'Room link or code': 'रूम लिंक या कोड',
    'Join': 'जुड़ें',
    'Joining…': 'जुड़ रहे हैं…',
    'the host is not playing yet': 'होस्ट ने अभी गाना नहीं चलाया है',
    'playing': 'चल रहा है',
    'paused': 'रुका हुआ है',
    'Find it in Spotify': 'Spotify में खोजें',
    'Syncing with the host…': 'होस्ट के साथ सिंक हो रहा है…',
    'In sync ✓': 'सिंक हो गया ✓',
    'Sync is off: you are playing on your own.': 'सिंक बंद है: आप अपने हिसाब से सुन रहे हैं।',
    'Keep my player in sync': 'मेरे प्लेयर को सिंक रखें',
    "Matches the host's play, pause and position": 'होस्ट के प्ले, पॉज़ और गाने की स्थिति से मिलाता है',
    'Room role': 'रूम की भूमिका',
    'Nearby screens (TV mode)': 'पास की स्क्रीन (TV मोड)',
    'Show lyrics on other screens': 'दूसरी स्क्रीन पर बोल दिखाएँ',
    'Same Wi-Fi, no internet needed: scan the QR code on a phone, tablet, laptop or TV browser to get big synced lyrics. Off by default': 'एक ही Wi-Fi पर इंटरनेट की ज़रूरत नहीं। फ़ोन, टैबलेट, लैपटॉप या TV ब्राउज़र से QR कोड स्कैन करके बड़े, सिंक हुए बोल देखें। डिफ़ॉल्ट रूप से बंद।',
    'TV and party mode': 'TV और पार्टी मोड',
    'Stream sound too (Jam nearby)': 'आवाज़ भी स्ट्रीम करें (Jam nearby)',
    "Lets devices on your Wi-Fi press Listen and hear this PC's sound with the lyrics. It sends everything this PC plays, only over your local network, and only while someone is listening. For you and the people in your home": 'आपके Wi-Fi पर डिवाइस Listen दबाकर बोलों के साथ इस PC की आवाज़ सुन सकते हैं। आवाज़ केवल स्थानीय नेटवर्क पर और सुनने के दौरान भेजी जाती है।',
    'Stream sound': 'आवाज़ स्ट्रीम करें',
    'Starting… If nothing appears, check that you are connected to Wi-Fi or a network.': 'शुरू हो रहा है… अगर कुछ न दिखे, तो Wi-Fi या नेटवर्क कनेक्शन जाँचें।',
    'Open this on any device on the same Wi-Fi. Keep the link private: anyone who has it can see what you play.': 'इसे उसी Wi-Fi पर किसी भी डिवाइस में खोलें। लिंक निजी रखें: जिसके पास लिंक होगा, वह देख सकेगा कि आप क्या चला रहे हैं।',
    'TV link': 'TV लिंक',
    'System': 'सिस्टम',
    'Launch at startup': 'स्टार्टअप पर शुरू करें',
    'Applies to installed builds': 'इंस्टॉल किए गए संस्करणों पर लागू',
    'Control system volume': 'सिस्टम वॉल्यूम नियंत्रित करें',
    'Windows source. Loads a helper that some antivirus tools flag': 'Windows स्रोत। एक सहायक प्रोग्राम लोड होता है जिसे कुछ एंटीवायरस चिह्नित कर सकते हैं।',
    'Global shortcuts': 'ग्लोबल शॉर्टकट',
    'Track change notifications': 'गाना बदलने की सूचनाएँ',
    'Open': 'खोलें',
    'Notification access': 'सूचना एक्सेस',
    'Lets Lyra see what is playing': 'Lyra को चल रहा गाना देखने देता है'
  }
}

function readLanguage(): Language {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en'
  } catch {
    return 'en'
  }
}

let currentLanguage = readLanguage()
const listeners = new Set<() => void>()

export function setLanguage(language: Language): void {
  currentLanguage = language
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // The selection still applies for this session when storage is unavailable.
  }
  listeners.forEach((listener) => listener())
}

export function translate(key: string): string {
  return translations[currentLanguage][key] ?? key
}

export function useTranslation(): { language: Language; setLanguage: typeof setLanguage; t: typeof translate } {
  const [language, setCurrentLanguage] = useState<Language>(currentLanguage)

  useEffect(() => {
    const update = (): void => setCurrentLanguage(currentLanguage)
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])

  return { language, setLanguage, t: translate }
}
