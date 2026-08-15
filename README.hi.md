<div align="center">

# 🛡️ dsh-permission-rules

**DeepSeek Harness के लिए Claude Code-शैली की घोषणात्मक अनुमति नियम (permission rules)।**

*नियम ज्ञात को तय करते हैं। एक समीक्षक मॉडल अज्ञात को तय करता है।*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-permission-rules/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-permission-rules?label=version)](https://github.com/PerryLink/dsh-permission-rules/releases)
[![npm version](https://img.shields.io/npm/v/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)
[![npm downloads](https://img.shields.io/npm/dm/dsh-permission-rules)](https://www.npmjs.com/package/dsh-permission-rules)

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
- ✅ **समृद्ध मिलान** — टूल-नाम globs (`mcp__*` सहित), एजेंट-पहचान चयनकर्ता (`main` / `subagent` / `preset:*`), आर्गुमेंट कुंजी/मान globs **या** regex (`!pattern` निषेध और `absent` कुंजी आयाम के साथ), दस्तावेज़ित आर्गुमेंट कुंजियों से **किसी भी नेस्टिंग गहराई** पर निकाले गए workspace-सापेक्ष पथ globs, और `when` होस्ट शर्तें (env vars, प्लेटफ़ॉर्म)
- ✅ **पदानुक्रमित नियम फ़ाइलें** — वैकल्पिक `searchUp` सत्र cwd से फ़ाइलसिस्टम रूट तक हर `.dsh/rules.yaml` को मिलाता है, निकटतम पहले, ताकि चाइल्ड प्रोजेक्ट पैरेंट नियमों को ओवरराइड कर सके
- ✅ **नियम मेटाडेटा** — `enabled: false`, `description`, `tags`; `/rules` पहले किसी catch-all से छिपे नियमों की चेतावनी देता है
- ✅ **waterfall-सुरक्षित** — `allow`/पास-थ्रू हमेशा `next()` बुलाते हैं; केवल `deny`/`ask` शॉर्ट-सर्किट करते हैं
- ✅ **आधिकारिक approval seam** — `ask` `ctx.approval` से होकर जाता है; कभी पुनः-कार्यान्वित नहीं, कभी बायपास नहीं
- ✅ **पूर्ण ऑडिट** — `permissionRules/decision` इवेंट हर कॉल के लिए नियम क्रिया, workspace cwd और अंतिम परिणाम रखते हैं; `/rules decisions` सत्र में रास्ता फिर चलाता है; ऑडिट एन्वेलप मार्कर से पुराने होस्ट अप्राप्य लॉग लिखने के बजाय एक-बार चेतावनी के साथ ऑडिट-बंद हो जाते हैं (`allowUnmarkedAudit` पुनः चालू करता है)
- ✅ **dry-run रोलआउट** — `enforce: false` केवल ऑडिट करता है कि नीति *क्या करती* (काल्पनिक क्रिया + वास्तविक डाउनस्ट्रीम परिणाम, `dryRun` चिह्नित) और हर कॉल को पास करता है; उत्पादन में नई नीति का सुरक्षित परीक्षण
- ✅ **dry-run परीक्षण** — `/rules test <tool> <json-args>` कुछ भी निष्पादित किए बिना सक्रिय नियमों का मूल्यांकन करता है, हर मिलान आयाम के लिए `--cwd`, `--env`, `--agent` और `--platform` ओवरराइड के साथ
- ✅ **हॉट रीलोड** — debounce सहित Chokidar निगरानी; टूटा हुआ संपादन पिछले नियम रखता है, कभी क्रैश नहीं करता; सत्र के बीच बनाई गई नियम फ़ाइल (प्रोजेक्ट की या fallback) स्वतः अपनाई जाती है, मैनुअल रीलोड की आवश्यकता नहीं
- ✅ **ज़ोरदार विफलता** — अमान्य YAML, अज्ञात action/फ़ील्ड, ख़राब globs/regex, बैकट्रैकिंग-प्रवण पैटर्न, या `maxRules` से अधिक → लोड विफल
- ✅ **सीमित हॉट पथ** — पूर्व-संकलित matchers, O(नियम × पैटर्न), `maxRules` द्वारा सीमित; glob बैकट्रैकिंग डिग्री `maxGlobStars` द्वारा सीमित

## त्वरित शुरुआत

```sh
# 1. bundle को अपने प्रोफ़ाइल में इंस्टॉल करें
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# या पैक किए गए tarball से (बिल्ट आर्टिफ़ैक्ट, build अनुमति की ज़रूरत नहीं)
pnpm pack
dsh plugin --profile web add ./dsh-permission-rules-0.4.1.tgz

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
| `maxRules` | `256` | प्रभावी स्रोत शृंखला में नियमों की कठोर सीमा; बड़ी फ़ाइलें लोड विफल करती हैं |
| `maxCachedWorkspaces` | `512` | कैश की गई प्रति-वर्कस्पेस नियम लोड की कठोर सीमा; इससे अधिक पर सबसे कम हाल में प्रयुक्त वर्कस्पेस (उसके watcher सहित) हटाया जाता है |
| `patternMode` | `glob` | `params`/`paths`/`when.env` पैटर्न शैली: `glob` या `regex` (टूल नाम हमेशा globs) |
| `watch` | `true` | Chokidar निगरानी + बदलाव पर रीलोड |
| `watchStabilityThresholdMs` | `200` | रीलोड debounce विंडो (ms) |
| `language` | `en` | `/rules` आउटपुट भाषा: `en`, `zh`, `es`, `pt`, `hi` (`en`/`zh` संदर्भ अनुवाद हैं) |
| `caseInsensitivePaths` | *(win32)* | `paths` पैटर्न और workspace-रूट तुलना ASCII केस अनदेखा करते हैं; Windows पर डिफ़ॉल्ट `true`, अन्यत्र `false` |
| `audit` | `all` | ऑडिट विवरण स्तर: `all` हर मिलान और पास-थ्रू लॉग करता है; `hits` पास-थ्रू इवेंट छोड़ता है |
| `searchUp` | `false` | सत्र cwd से पैरेंट निर्देशिकाओं पर चलकर हर मिली नियम फ़ाइल मिलाता है, निकटतम पहले |
| `maxGlobStars` | `2` | प्रति glob पैटर्न असीमित `*`/`**` क्वांटिफ़ायर की कठोर सीमा (बैकट्रैकिंग-डिग्री सीमा) |
| `enforce` | `true` | `false` = dry-run मोड: deny/ask मिलान केवल ऑडिट में `dryRun` चिह्न के साथ दर्ज होते हैं (काल्पनिक क्रिया + वास्तविक डाउनस्ट्रीम परिणाम) और हर कॉल पास होती है — लागू करने से पहले नीति का परीक्षण करें |
| `allowUnmarkedAudit` | `false` | जिन होस्ट का `Session.append` `ignorable` मार्कर से पुराना है (`0.1.0-rc.6` शृंखला) वे बिना-चिह्न ऑडिट इवेंट लिखते हैं, जिससे सत्र कठोर बिल्ड पर अप्राप्य हो जाते हैं: प्लगइन ऐसे होस्ट का पता लगाकर एक-बार चेतावनी के साथ सत्र-लॉग ऑडिट बंद कर देता है। सत्र में रास्ता वापस चाहिए तो `true` सेट करें (मौजूदा लॉग `scripts/repair-session-logs.mjs` से मरम्मत करें) |

### सेशन कमांड

```
/rules                        सक्रिय नियम, उनकी स्रोत फ़ाइलें और अंतिम रीलोड त्रुटि दिखाता है
/rules list                   सामान्य सूची का स्पष्ट उपनाम
/rules reload                 इस workspace की नियम-फ़ाइल शृंखला दोबारा पढ़ता है
/rules decisions [n]          इस सत्र की अंतिम n अनुमति निर्णय दिखाता है (डिफ़ॉल्ट 10)
/rules test <tool> <json>     काल्पनिक कॉल के विरुद्ध नियमों का dry-मूल्यांकन, जैसे /rules test bash {"command":"git push origin main"}
```

`/rules test` शुरुआती फ़्लैग भी स्वीकार करता है: `--cwd <dir>` दूसरे workspace के विरुद्ध मूल्यांकन करता है, `--env KEY=मान` (दोहराने योग्य) `when.env` के लिए होस्ट env ओवरराइड करता है, `--agent <चयनकर्ता>` (दोहराने योग्य) `agents` आयाम के लिए पहचान उम्मीदवार देता है, और `--platform <नाम>` `when.platform` के लिए होस्ट प्लेटफ़ॉर्म ओवरराइड करता है। बहु-फ़ाइल शृंखलाओं (जैसे `searchUp`) में हर नियम पंक्ति अपनी स्रोत फ़ाइल के साथ चिह्नित होती है।

कमांड आउटपुट केवल UI के लिए है — मॉडल नियमों को केवल उनके उत्पन्न टूल परिणामों से ही सीखता है। `language` आउटपुट भाषा चुनता है। नियम फ़ाइल का JSON Schema [docs/rules-format.schema.json](docs/rules-format.schema.json) पर साथ आता है (संपादक पूर्णता के लिए `# yaml-language-server: $schema=...` से जोड़ें)।

## dsh-auto-review के साथ सहयोग

- `dsh-permission-rules` `ask` उत्पन्न करता है; `dsh-auto-review` `approval/request` waterfall पर केवल-पठन दूसरे मॉडल के निर्णय से उत्तर देता है (या मानवों को सौंपता है)। पूर्ण चक्र के लिए दोनों माउंट करें।
- एकीकरण-परीक्षित (`test/integration.spec.ts`): `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, समीक्षक की जगह स्क्रिप्टेड mock।
- [आधिकारिक harness](https://github.com/deepseek-ai/deepseek-harness) की `never` अनुमोदन नीति और हर fail-closed गारंटी अछूती रहती हैं।

## सुरक्षा सीमाएँ

- **नीति, कर्नेल नहीं।** `paths` उम्मीदवार केवल दस्तावेज़ित आर्गुमेंट-कुंजी समूह से आते हैं, और केवल workspace-सापेक्ष पथ मिलते हैं।
- **यहाँ कोई समीक्षक नहीं।** प्लगइन कभी सबएजेंट नहीं चलाता, मॉडल नहीं बुलाता — `ask` निर्णय देना ही उसके काम का अंत है।
- **sandbox में कोई बदलाव नहीं।** OS-स्तरीय sandbox नीति sandbox seam का काम है, इस प्लगइन का नहीं।
- **ग़लत कॉन्फ़िगरेशन पर ज़ोरदार अस्वीकृति।** अज्ञात YAML फ़ील्ड, अज्ञात action और ख़राब पैटर्न लोड पर अस्वीकृत होते हैं, कभी चुपचाप अनदेखे नहीं।
- **बैकट्रैकिंग सीमाएँ।** glob पैटर्न `maxGlobStars` असीमित स्टार विस्तार तक सीमित हैं; regex-मोड पैटर्न नेस्टेड असीमित क्वांटिफ़ायर और क्वांटिफ़ाइड ओवरलैपिंग शाब्दिक विकल्पों को अस्वीकार करते हैं। (`\d+\.\d+\.\d+` जैसी regex शृंखलाएँ अनुमत रहती हैं — regex मोड एस्केप हैच है, glob मोड संरक्षित डिफ़ॉल्ट है।)

## संबंधित कार्य

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — दो-अवस्था allow/deny वर्गीकारक, अपनी फ़ाइल-लॉग ऑडिट के साथ; यह प्लगइन पूर्ण तीन-अवस्था शब्दार्थ, घोषणात्मक YAML नियम, सेशन-लॉग ऑडिट और `next()`-सुरक्षित सौंप जोड़ता है।
- `Drifter-yh/dsh-tool-policy` — deny-by-default टूल नीति; दोहराने से बचने के लिए यहाँ दस्तावेज़ित।
- `dsh-auto-review` — इस चक्र का AI-सहारा आधा भाग, जिसका यह प्लगइन अग्रिम छोर है।

## ज्ञात सीमाएँ

- `permissionRules/decision` एन्वेलप के `ignorable: true` मार्कर के साथ जोड़ा जाता है, इसलिए कोई भी harness बिल्ड लॉग लोड कर लेता है — जो पाठक इस आउट-ऑफ-रेपो प्रकार को नहीं जानते वे सत्र अस्वीकार करने के बजाय केवल ऑडिट रिकॉर्ड छोड़ देते हैं। मार्कर से पुराने होस्ट (`0.1.0-rc.6` शृंखला) इसे चुपचाप गिरा देते हैं: प्लगइन रनटाइम पर उन्हें पहचानता है (peer संस्करण पूर्व-जाँच + जोड़े गए एन्वेलप की जाँच) और एक-बार चेतावनी के साथ सत्र-लॉग ऑडिट बंद कर देता है, ताकि लॉग हर जगह लोड होते रहें। सत्र में रास्ता वापस चाहिए तो `allowUnmarkedAudit: true` सेट करें; बिना-चिह्न लिखे गए लॉग required-on-read शब्दार्थ वाले होस्ट पर लोड से पहले `scripts/repair-session-logs.mjs` से मरम्मत किए जा सकते हैं।
- `paths` उम्मीदवार ह्यूरिस्टिक हैं: केवल दस्तावेज़ित आर्गुमेंट-कुंजियाँ पथ मिलान में आती हैं, और workspace-सापेक्ष मिलान केवल तभी ASCII-केस-असंवेदनशील होता है जब `caseInsensitivePaths` चालू हो।
- globs एक रूढ़िवादी उपसमुच्चय हैं (brace विस्तार नहीं) — दो पैटर्न लिखें या regex मोड इस्तेमाल करें।
- regex बैकट्रैकिंग गार्ड संरचनात्मक है, संपूर्ण नहीं: शाब्दिक उपसर्ग के बिना विकल्प-अस्पष्टता के मामले (जैसे कृत्रिम lookarounds) लेखक की ज़िम्मेदारी हैं; अविश्वसनीय फ़ाइलों के लिए glob मोड पसंद करें।

## सत्र लॉग मरम्मत

`ignorable` मार्कर से पहले लिखे गए सत्र लॉग को नए harness बिल्ड अस्वीकार कर सकते हैं (`SessionFormatUnsupportedError`)। शामिल `scripts/repair-session-logs.mjs` केवल लक्षित ऑडिट पंक्तियों में `ignorable: true` जोड़ता है, फ़्रेम सुरक्षित रखते हुए, बैकअप के साथ:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # बाहरी पंक्तियों की रिपोर्ट, कोई बदलाव नहीं
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` डिफ़ॉल्ट रूप से `$DSH_HOME/sessions` (या `~/.dsh/sessions`) है। पूरा अनुबंध स्क्रिप्ट के शीर्ष में है।

## विकास

```sh
pnpm install        # node ^22.19 || >=24
pnpm run typecheck  # tsc, src + tests
pnpm run lint       # eslint, src + tests + scripts
pnpm test           # vitest: 139 tests, 9 suites
pnpm run test:coverage  # कवरेज द्वार (90/80/90/90)
pnpm run build      # tsc डिक्लेरेशन + tsdown bundles (lib/)
pnpm run pack:check # build + pack (प्रकाशित आर्टिफ़ैक्ट)
node scripts/check-readme-sync.mjs  # पाँच-भाषा README सिंक द्वार (CI में भी)
```

headless एंड-टू-एंड सत्यापन रिकॉर्ड (deny द्वारा shell टूल रोकना, ask का approval seam से गुज़रना, `--dump-config`) [VERIFICATION.md](VERIFICATION.md) में देखें।

## योगदानकर्ता

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: नियम शब्दावली व मूल्यांकन, runtime, HMR निगरानी, सत्र-लॉग ऑडिट और पाँच-भाषा दस्तावेज़।
- [@22xuan](https://github.com/22xuan) — rc.6 होस्ट द्वारा ऑडिट इवेंट के `ignorable` मार्कर को चुपचाप गिराने की विस्तृत रिपोर्ट ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) और अपस्ट्रीम harness चर्चा; v0.4.1 की रनटाइम होस्ट-क्षमता पहचान और दस्तावेज़ सुधार सीधे उसी विश्लेषण से निकले हैं।

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
