<div align="center">

# 🛡️ dsh-permission-rules

**DeepSeek Harness के लिए Claude Code-शैली की घोषणात्मक अनुमति नियम (permission rules)।**

*नियम ज्ञात को तय करते हैं। एक समीक्षक मॉडल अज्ञात को तय करता है।*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![Tests](https://img.shields.io/badge/tests-58%20passed-success.svg)](#विकास)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](package.json)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## यह क्या करता है

`dsh-permission-rules` हर टूल कॉल के आगे `tools/pre-execute` waterfall पर एक क्रमबद्ध **`allow` / `deny` / `ask`** नियम-सूची रखता है — नियतात्मक, तात्कालिक, ऑडिट-योग्य, और आपके द्वारा सादे YAML में लिखी हुई:

- **`deny`** कॉल को रोक देता है। नियम का `reason` मॉडल को दिखने वाली त्रुटि बन जाता है, ताकि एजेंट आँख बंद करके दोबारा कोशिश करने के बजाय *कारण* सीखे।
- **`ask`** आधिकारिक approval seam से होकर जाता है। साथ में `dsh-auto-review` माउंट करें तो दूसरा मॉडल फ़ैसला करता है; वरना मानव उत्तर देता है; दोनों के न होने पर harness fail-closed रहता है।
- **`allow`** (और कोई मिलान न होने पर) सख़्ती से `next()` से सौंपता है — बाद वाले listeners कभी शॉर्ट-सर्किट नहीं होते।

हर मिलान **और** हर पास-थ्रू `permissionRules/decision` सेशन इवेंट के रूप में ऑडिट-लॉग होता है (केवल लॉग — मॉडल संदर्भ में कुछ अतिरिक्त नहीं डाला जाता)।

```text
tools/pre-execute waterfall                     approval/request waterfall (answerer शृंखला)
        │                                                   │
  dsh-permission-rules                                dsh-auto-review answerer
   · फ़ाइल क्रम में पहला मिलान            ┌───────────────┴──────────────┐
   · deny/ask कॉल को अपनाते हैं           │ AI निर्णय (दूसरा मॉडल)        │ नहीं ── next() ──▶ मानव UI
   · allow/पास-थ्रू → next()              └───────────────┬──────────────┘
        │ deny ──▶ अस्वीकृत टूल परिणाम                   │ allowed-once / rejected
        │ ask  ──▶ ctx.approval ────────────────────────┘
        │
   ऑडिट: permissionRules/decision → approval/asked → autoReview/verdict → approval/decided
```

## नियम *और* समीक्षक दोनों क्यों?

दूसरा मॉडल *"क्या यह कॉल सुरक्षित है?"* का उत्तर निर्णय-क्षमता से देता है, लेकिन इसमें एक राउंड-ट्रिप लगता है और यह ग़लत भी हो सकता है। घोषणात्मक नियम नियतात्मक, तात्कालिक और बिना मॉडल के उत्तर देते हैं — लेकिन केवल वही कवर करते हैं जो व्यवस्थापक ने लिखा। दोनों मिलकर **"पहले नियम, फिर AI सहारा"** चक्र बनाते हैं: नियम ज्ञात को तय करते हैं, समीक्षक अज्ञात को।

## विशेषताएँ

- ✅ **तीन-अवस्था शब्दार्थ** — `allow`, `deny`, `ask`, फ़ाइल क्रम में मूल्यांकित; पहला मिलान जीतता है
- ✅ **समृद्ध मिलान** — टूल-नाम globs (`mcp__*` सहित), आर्गुमेंट कुंजी/मान globs **या** regex, workspace-सापेक्ष पथ globs
- ✅ **waterfall-सुरक्षित** — `allow`/पास-थ्रू हमेशा `next()` बुलाते हैं; केवल `deny`/`ask` शॉर्ट-सर्किट करते हैं
- ✅ **आधिकारिक approval seam** — `ask` `ctx.approval` से होकर जाता है; कभी पुनः-कार्यान्वित नहीं, कभी बायपास नहीं
- ✅ **पूर्ण ऑडिट** — हर मिलान और पास-थ्रू के लिए `permissionRules/decision` इवेंट
- ✅ **हॉट रीलोड** — debounce सहित Chokidar निगरानी; टूटा हुआ संपादन पिछले नियम रखता है, कभी क्रैश नहीं करता
- ✅ **ज़ोरदार विफलता** — अमान्य YAML, अज्ञात action, ख़राब globs/regex, या `maxRules` से अधिक → लोड विफल
- ✅ **सीमित हॉट पथ** — पूर्व-संकलित matchers, O(नियम × पैटर्न), `maxRules` द्वारा सीमित

## त्वरित शुरुआत

```sh
# 1. bundle को अपने प्रोफ़ाइल में इंस्टॉल करें
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# या पैक किए गए tarball से (बिल्ट आर्टिफ़ैक्ट, build अनुमति की ज़रूरत नहीं)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.1.0.tgz

# 2. पुनः आरंभ करें
dsh --profile web
```

फिर अपने प्रोजेक्ट के लिए नियम फ़ाइल बनाएँ और उसी में सेशन शुरू करें:

```yaml
# <project>/.dsh/rules.yaml
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "संरक्षित पथों से push मना है"

  - match: { tools: [edit, write] }
    action: ask
    reason: "फ़ाइल लिखने के लिए पुष्टि चाहिए"
```

```sh
dsh --profile web --dump-config | grep -A4 'id: permission-rules'   # पंक्ति सत्यापित करें
```

5 नियमों वाली पूरी सुरक्षा बेसलाइन और पूरा schema [docs/rules-format.en.md](docs/rules-format.en.md) में है।

## कॉन्फ़िगरेशन

सभी ट्यूनेबल Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। id-लक्षित ओवरराइड पूरी पंक्ति बदल देता है — जिन कुंजियों की ज़रूरत हो उन्हें दोबारा लिखें।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | नियम फ़ाइल का स्थान; सापेक्ष = कॉलिंग सेशन के cwd के विरुद्ध, निरपेक्ष = वैश्विक और माउंट पर सत्यापित |
| `fallbackPath` | *(कोई नहीं)* | cwd खोज में कुछ न मिलने पर प्रयुक्त नियम फ़ाइल; माउंट पर सत्यापित |
| `badFilePolicy` | `fail` | ख़राब फ़ाइल: `fail` लंबित टूल कॉल को ज़ोरदार त्रुटि देता है (रीलोड पिछले नियम रखते हैं); `ignore-with-warning` चेतावनी देकर ख़ाली चलता है |
| `maxRules` | `256` | नियमों की कठोर सीमा; बड़ी फ़ाइलें लोड विफल करती हैं |
| `patternMode` | `glob` | `params`/`paths` पैटर्न शैली: `glob` या `regex` (टूल नाम हमेशा globs) |
| `watch` | `true` | Chokidar निगरानी + बदलाव पर रीलोड |
| `watchStabilityThresholdMs` | `200` | रीलोड debounce विंडो (ms) |

### सेशन कमांड

```
/rules           सक्रिय नियम, उनकी स्रोत फ़ाइल और अंतिम रीलोड त्रुटि दिखाता है
/rules reload    इस workspace की नियम फ़ाइल दोबारा पढ़ता है
```

कमांड आउटपुट केवल UI के लिए है — मॉडल नियमों को केवल उनके उत्पन्न टूल परिणामों से ही सीखता है।

## dsh-auto-review के साथ सहयोग

- `dsh-permission-rules` `ask` उत्पन्न करता है; `dsh-auto-review` `approval/request` waterfall पर केवल-पठन दूसरे मॉडल के निर्णय से उत्तर देता है (या मानवों को सौंपता है)। पूर्ण चक्र के लिए दोनों माउंट करें।
- एकीकरण-परीक्षित (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, समीक्षक की जगह स्क्रिप्टेड mock।
- [आधिकारिक harness](https://github.com/deepseek-ai/deepseek-harness) की `never` अनुमोदन नीति और हर fail-closed गारंटी अछूती रहती हैं।

## सुरक्षा सीमाएँ

- **नीति, कर्नेल नहीं।** `paths` उम्मीदवार केवल दस्तावेज़ित आर्गुमेंट-कुंजी समूह से आते हैं, और केवल workspace-सापेक्ष पथ मिलते हैं।
- **यहाँ कोई समीक्षक नहीं।** प्लगइन कभी सबएजेंट नहीं चलाता, मॉडल नहीं बुलाता — `ask` निर्णय देना ही उसके काम का अंत है।
- **sandbox में कोई बदलाव नहीं।** OS-स्तरीय sandbox नीति sandbox seam का काम है, इस प्लगइन का नहीं।
- **ग़लत कॉन्फ़िगरेशन पर ज़ोरदार अस्वीकृति।** अज्ञात YAML फ़ील्ड, अज्ञात action और ख़राब पैटर्न लोड पर अस्वीकृत होते हैं, कभी चुपचाप अनदेखे नहीं।

## संबंधित कार्य

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — दो-अवस्था allow/deny वर्गीकारक, अपनी फ़ाइल-लॉग ऑडिट के साथ; यह प्लगइन पूर्ण तीन-अवस्था शब्दार्थ, घोषणात्मक YAML नियम, सेशन-लॉग ऑडिट और `next()`-सुरक्षित सौंप जोड़ता है।
- `Drifter-yh/dsh-tool-policy` — deny-by-default टूल नीति; दोहराने से बचने के लिए यहाँ दस्तावेज़ित।
- `dsh-auto-review` — इस चक्र का AI-सहारा आधा भाग, जिसका यह प्लगइन अग्रिम छोर है।

## ज्ञात सीमाएँ

- बाहरी प्लगइन के सेशन इवेंट (`permissionRules/decision`) उन प्रथम-पक्ष पाठकों द्वारा अस्वीकृत होते हैं जो प्रकार नहीं जानते — ज़ोरदार, चुप नहीं (harness की प्री-रिलीज़ स्थिति; सभी बाहरी प्लगइन इवेंट के साथ साझा)।
- `paths` उम्मीदवार ह्यूरिस्टिक हैं: केवल दस्तावेज़ित आर्गुमेंट-कुंजियाँ पथ मिलान में आती हैं।
- globs एक रूढ़िवादी उपसमुच्चय हैं (brace विस्तार नहीं) — दो पैटर्न लिखें या regex मोड इस्तेमाल करें।

## विकास

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm test           # vitest: 58 tests, 7 suites
pnpm run build      # tsc डिक्लेरेशन + tsdown bundles (lib/)
pnpm pack           # प्रकाशन आर्टिफ़ैक्ट
```

headless एंड-टू-एंड सत्यापन रिकॉर्ड (deny द्वारा shell टूल रोकना, ask का approval seam से गुज़रना, `--dump-config`) [VERIFICATION.md](VERIFICATION.md) में देखें।

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
