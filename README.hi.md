<div align="center">

# 🛡️ dsh-permission-rules

**DeepSeek Harness के लिए Claude Code-शैली की घोषणात्मक अनुमति नियम।**

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

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2` |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | सभी (host + वेब settings क्लाइंट) |
| Model | कोई भी (deny/ask कारण टूल परिणामों के माध्यम से दिखते हैं) |

## What you get

`dsh-permission-rules` `tools/pre-execute` वॉटरफ़ॉल पर हर टूल कॉल के आगे एक क्रमबद्ध **`allow` / `deny` / `ask`** नियम सूची रखता है — नियतात्मक, तत्काल, लेखा-परीक्षण-योग्य और आपके द्वारा सादे YAML में लिखी गई:

- **`deny`** कॉल को रोकता है; नियम का `reason` मॉडल-दृश्य त्रुटि बन जाता है।
- **`ask`** आधिकारिक अनुमोदन सीम पर चलता है (द्वितीय-मॉडल answerer के लिए `dsh-auto-review` माउंट करें, या मानव उत्तर देता है; दोनों न होने पर harness बंद-विफल होता है)।
- **`allow`** (और कोई-मिलान-नहीं) सख्ती से `next()` से प्रत्यायोजित करता है — बाद के listeners कभी शॉर्ट-सर्किट नहीं होते।

हर हिट **और** हर पास-थ्रू `permissionRules/decision` सत्र घटना के रूप में लॉग होता है (केवल-लॉग — मॉडल संदर्भ में कुछ भी अतिरिक्त इंजेक्ट नहीं होता)।

- **समृद्ध मिलान** — टूल-नाम globs (जिनमें `mcp__*` शामिल), एजेंट-पहचान चयनकर्ता (`main` / `subagent` / `preset:*`), तर्क कुंजी/मान globs **या** regex (जिनमें `!pattern` निषेध और `absent` कुंजी आयाम), **किसी भी नेस्टिंग गहराई** पर कार्यक्षेत्र-सापेक्ष पथ globs, और `when` होस्ट शर्तें (env चर, प्लेटफ़ॉर्म)।
- **पदानुक्रमित नियम फ़ाइलें** — वैकल्पिक `searchUp` सत्र cwd से फ़ाइल-सिस्टम रूट तक हर `.dsh/rules.yaml` को मर्ज करता है, निकटतम पहले।
- **dry-run रोलआउट** — `enforce: false` ऑडिट करता है कि नीति *क्या* करती, हर कॉल को पास करते हुए।
- **हॉट रीलोड** — debounce सहित Chokidar निगरानी; टूटा संपादन पिछले नियम रखता है, कभी क्रैश नहीं।
- **ज़ोर से विफल** — अमान्य YAML, अज्ञात action/फ़ील्ड, ख़राब globs/regex, बैकट्रैकिंग-प्रवण पैटर्न या `maxRules` से अधिक नियम लोड को विफल करते हैं।

## Rule syntax

```yaml
# <project>/.dsh/rules.yaml
rules:
  - match: { tools: [bash, pwsh], params: { command: "git push*" }, paths: ["**/secrets/**"] }
    action: deny
    reason: "No pushes from protected paths"

  - match: { tools: [edit, write] }
    action: ask
    reason: "File writes need confirmation"
```

- **मिलान आयाम** — `tools` (globs, incl. `mcp__*`), `agents` (`main` / `subagent` / `preset:<name>`; अज्ञात पहचान कभी मिलान नहीं करती — बंद-विफल), `params` (कुंजी/मान globs या regex, `!pattern` निषेध, `absent` कुंजी आयाम), `paths` (किसी भी गहराई पर निकाले गए कार्यक्षेत्र-सापेक्ष globs), `when` (`env` चर globs/regex + बंद `platform` सूची), और `network` (`domains` / `ips` / `ports` / `schemes` — globs, वाइल्डकार्ड, CIDR, पोर्ट श्रेणियाँ)।
- **क्रियाएँ** — `allow` / `deny` / `ask`, फ़ाइल क्रम में मूल्यांकित, पहला मिलान जीतता है।
- **नियम मेटाडेटा** — `enabled: false` (दृश्य परंतु निष्क्रिय), `description`, `tags`; अज्ञात फ़ील्ड लोड विफल करते हैं।
- **Schema** — JSON Schema [docs/rules-format.schema.json](docs/rules-format.schema.json) पर वितरित (संपादक पूर्णता `# yaml-language-server: $schema=...`); पूर्ण शब्दावली और 5-नियम सुरक्षा आधाररेखा [docs/rules-format.en.md](docs/rules-format.en.md) में।

## Network policy

Codex-शैली की **प्रक्रिया-स्तरीय नेटवर्क नीति**: shell उप-प्रक्रिया ट्रैफ़िक एक अंतर्निहित स्थानीय **HTTP/CONNECT प्रॉक्सी** से होकर गुज़रता है, और हर कनेक्शन क्रमबद्ध नेटवर्क नियमों या आधिकारिक sandbox presets पर मैप किए गए तीन मोड से तय होता है:

- **`deny-all`** — केवल-पठन sandbox preset: सभी आउटबाउंड रोकें।
- **`whitelist`** — workspace-write preset: सूचीबद्ध लक्ष्य अनुमत, शेष के लिए `unlisted: ask` (या `deny`)।
- **`allow-all`** — danger-full-access preset: सब कुछ अनुमत।
- **`auto`** (डिफ़ॉल्ट) — sandbox preset का अनुसरण करता है; बिना sandbox-नीति सेवा वाले hosts पर `autoFallback` (`allow-all`) में हल होता है।

- **मिलान** — `match.network` `domains` / `ips` / `ports` / `schemes` के साथ (globs, वाइल्डकार्ड, CIDR, पोर्ट श्रेणियाँ; संख्यात्मक YAML पोर्ट स्वीकृत)। `tools/pre-execute` हॉट पथ पर URL-उम्मीदवार निष्कर्षण वेब-टूल तर्कों और bash/pwsh कमांड टेक्स्ट में एम्बेडेड URLs पर चलता है; लूपबैक लक्ष्य `loopback` नीति के अनुसार नियमों को शॉर्ट-सर्किट कर सकते हैं।
- **ऑडिट** — अस्वीकृत कनेक्शन स्वामी सत्र में `permissionRules/network` जोड़ते हैं (वही अनुकूली `ignorable` द्वार), `/rules network` और settings पृष्ठ में ब्लॉक काउंटर व हाल की अवरोधन के साथ।

## Quick start

```sh
# 1. install the bundle into your profile
dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"

# or from npm (published releases)
dsh plugin --profile web add dsh-permission-rules

# 2. restart and verify the row
dsh --profile web --dump-config | grep -A4 'id: permission-rules'
```

## Install & uninstall

- **git चैनल** (नवीनतम `main`): `dsh plugin --profile web add "github:PerryLink/dsh-permission-rules#main"` — `prepare` स्क्रिप्ट केवल उत्पादन निर्भरताओं से बनाती है।
- **npm चैनल** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-permission-rules`.
- **tarball चैनल**: इस रेपो में `pnpm pack`, फिर `dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz`.
- **uninstall**: `dsh plugin --profile web remove dsh-permission-rules`.

## Configuration

सभी ट्यूनेबल Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। id-लक्षित ओवरराइड पूरी पंक्ति बदल देता है — हर आवश्यक कुंजी फिर से बताएँ।

| Key | Default | Meaning |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | नियम फ़ाइल स्थान; सापेक्ष = कॉलिंग सत्र cwd के विरुद्ध हल, निरपेक्ष = वैश्विक और माउंट पर मान्य |
| `fallbackPath` | *(none)* | प्रति-cwd खोज में कुछ न मिलने पर उपयोग की गई नियम फ़ाइल; माउंट पर मान्य |
| `badFilePolicy` | `fail` | ख़राब नियम फ़ाइल: `fail` लंबित टूल कॉल को ज़ोर से विफल करता है; `ignore-with-warning` चेतावनी देकर खाली जारी रखता है |
| `maxRules` | `256` | प्रभावी स्रोत शृंखला में नियम संख्या की कठोर सीमा |
| `maxCachedWorkspaces` | `512` | कैश किए गए प्रति-कार्यक्षेत्र नियम लोड की कठोर सीमा (LRU निष्कासन) |
| `patternMode` | `glob` | `params`/`paths`/`when.env` पैटर्न स्वाद: `glob` या `regex` (टूल नाम हमेशा globs) |
| `watch` | `true` | Chokidar निगरानी + परिवर्तन पर रीलोड |
| `watchStabilityThresholdMs` | `200` | रीलोड debounce विंडो (ms) |
| `language` | `en` | `/rules` आउटपुट भाषा: `en`, `zh`, `es`, `pt`, `hi` |
| `caseInsensitivePaths` | *(win32)* | `paths` पैटर्न और कार्यक्षेत्र-रूट तुलना ASCII केस अनदेखा करते हैं; Windows पर `true` |
| `audit` | `all` | ऑडिट दानेदारी: `all` हर हिट और पास-थ्रू लॉग करता है; `hits` पास-थ्रू घटनाएँ छोड़ता है |
| `searchUp` | `false` | सत्र cwd से मूल निर्देशिकाओं को चलकर हर मिली नियम फ़ाइल मर्ज करें, निकटतम पहले |
| `maxGlobStars` | `2` | प्रति glob पैटर्न असीमित `*`/`**` क्वांटिफ़ायर की कठोर सीमा |
| `enforce` | `true` | `false` = dry-run मोड: deny/ask हिट `dryRun` मार्कर से लॉग होते हैं और हर कॉल पास होता है |
| `allowUnmarkedAudit` | `false` | पूर्व-मार्कर hosts `ignorable` मार्कर छोड़ देते हैं; प्लगइन एक बार की चेतावनी से सत्र-लॉग ऑडिट अक्षम करता है। पुनः सक्षम के लिए `true` |
| `network.enabled` | `true` | प्रॉक्सी, env इंजेक्शन और वेब-टूल मोड डिफ़ॉल्ट का मुख्य स्विच |
| `network.mode` | `auto` | नीति मोड: `auto` sandbox preset का अनुसरण, या `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | `auto` के पास sandbox-नीति सेवा न होने पर उपयोग किया मोड |
| `network.unlisted` | `ask` | श्वेतसूची मोड में बिना नियम मिलान वाले लक्ष्यों का व्यवहार: `ask` या `deny` |
| `network.proxyBind` | `127.0.0.1` | स्थानीय प्रॉक्सी बाइंड पता (केवल लूपबैक) |
| `network.proxyPort` | `0` | स्थानीय प्रॉक्सी पोर्ट; `0` एक मुक्त क्षणिक पोर्ट चुनता है |
| `network.proxyMaxRecent` | `100` | settings पृष्ठ के लिए रखे हाल के ब्लॉक रिकॉर्ड की सीमा |
| `network.loopback` | `allow` | लूपबैक लक्ष्य: `allow` (Codex समता) या `policy` |
| `network.injectEnv` | `true` | क्या उप-प्रक्रियाओं के लिए प्रॉक्सी पर्यावरण चर इंजेक्ट हों |
| `network.noProxy` | `clear` | उप-प्रक्रिया NO_PROXY व्यवहार: `clear` नीति लागू करता है या `preserve` |

## Tools & surfaces

| Surface | Kind | Notes |
|---|---|---|
| `tools/pre-execute` | listener | पहले-मिलान allow/deny/ask नियम + नेटवर्क URL-उम्मीदवार निष्कर्षण |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | हर हिट और पास-थ्रू की केवल-लॉग ऑडिट |
| `permissionRules/network` | event | अवरुद्ध कनेक्शनों की प्रॉक्सी-परत ऑडिट |
| HTTP/CONNECT proxy | service | shell उप-प्रक्रिया ट्रैफ़िक को नियंत्रित करने वाला अंतर्निहित स्थानीय प्रॉक्सी |
| settings page | client | नेटवर्क-मोड संपादक, नियम संपादक, ब्लॉक काउंटर, हाल की अवरोधन |

```
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

`/rules test` अग्रणी फ़्लैग भी स्वीकार करता है: `--cwd <dir>`, `--env KEY=VALUE` (दोहराने-योग्य), `--agent <selector>` (दोहराने-योग्य) और `--platform <name>`। बहु-फ़ाइल शृंखलाओं (जैसे `searchUp`) में हर सूचीबद्ध नियम पंक्ति अपनी स्रोत फ़ाइल से संबद्ध होती है।

## Permissions & data

- **Permissions**: workshop मैनिफ़ेस्ट `files:read`, `files:watch`, `files:write`, `session:append` और `network:outbound` घोषित करता है। `ask` निर्णय आधिकारिक अनुमोदन सीम पर चलते हैं — कुछ भी पुनः-कार्यान्वित या टाला नहीं गया।
- **Data**: नियम फ़ाइलें डिस्क से पढ़ी जाती हैं; कोई नियम डेटा लिखा नहीं जाता। कोई मॉडल कॉल नहीं, कोई समीक्षक उप-एजेंट नहीं।
- **Session log**: `permissionRules/decision` कभी मॉडल संदर्भ में इंजेक्ट नहीं होता और लिफ़ाफ़े के `ignorable: true` मार्कर से जोड़ा जाता है ताकि कोई भी harness बिल्ड लॉग लोड कर सके।

## Security boundaries

- **नीति, कर्नेल नहीं।** `paths` उम्मीदवार केवल तर्क कुंजियों के एक दस्तावेज़ित समूह से आते हैं (किसी भी गहराई पर, गहराई-सीमित), और केवल कार्यक्षेत्र-सापेक्ष पथ मिलान करते हैं।
- **यहाँ कोई समीक्षक नहीं।** प्लगइन कभी उप-एजेंट नहीं बनाता या मॉडल नहीं बुलाता — `ask` निर्णय उत्पन्न करना ही इसके काम का अंत है।
- **कोई sandbox परिवर्तन नहीं।** OS-स्तरीय sandbox नीति sandbox सीम की है, इस प्लगइन की नहीं।
- **ग़लत विन्यास की ज़ोरदार अस्वीकृति।** अज्ञात YAML फ़ील्ड, अज्ञात क्रियाएँ और ख़राब पैटर्न लोड पर अस्वीकृत।
- **बैकट्रैकिंग सीमाएँ।** glob पैटर्न `maxGlobStars` असीमित स्टार विस्तार तक सीमित; regex-मोड पैटर्न नेस्टेड असीमित क्वांटिफ़ायर और क्वांटिफ़ाइड ओवरलैपिंग शाब्दिक विकल्प अस्वीकारते हैं।

## Known limitations

- **पूर्व-मार्कर hosts पर ऑडिट मार्कर।** `permissionRules/decision` `ignorable: true` से जोड़ा जाता है; जिन hosts का `Session.append` मार्कर से पहले का है (`0.1.0-rc.6` पंक्ति) वे इसे चुपचाप छोड़ देते हैं, इसलिए runtime एक बार की चेतावनी से सत्र-लॉग ऑडिट अक्षम कर देता है। पुनः सक्षम के लिए `allowUnmarkedAudit: true`; पहले से लिखे लॉग `scripts/repair-session-logs.mjs` से मरम्मत करें।
- **पथ उम्मीदवार अनुमानी हैं।** केवल दस्तावेज़ित तर्क कुंजियाँ पथ मिलान को खिलाती हैं, और कार्यक्षेत्र-सापेक्ष मिलान केवल `caseInsensitivePaths` चालू होने पर ASCII-केस-असंवेदी है।
- **globs एक रूढ़िवादी उपसमुच्चय हैं।** कोई ब्रेस विस्तार नहीं — दो पैटर्न लिखें, या regex मोड उपयोग करें।
- **regex बैकट्रैकिंग गार्ड संरचनात्मक है, संपूर्ण नहीं।** अविश्वसनीय फ़ाइलों के लिए glob मोड पसंद करें।

## Collaborating with dsh-auto-review

- `dsh-permission-rules` `ask` उत्पन्न करता है; `dsh-auto-review` `approval/request` वॉटरफ़ॉल पर केवल-पठन द्वितीय-मॉडल निर्णय से उत्तर देता है (या मानवों को प्रत्यायोजित करता है)। पूर्ण बंद लूप के लिए दोनों माउंट करें।
- एकीकरण-परीक्षित: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, समीक्षक को स्क्रिप्टेड मॉक से बदलकर।
- आधिकारिक harness की `never` अनुमोदन नीति और हर बंद-विफल गारंटी अछूती रहती हैं।

## Session log repair

`ignorable` मार्कर के अस्तित्व से पहले लिखे गए सत्र लॉग नए harness बिल्ड द्वारा अस्वीकृत हो सकते हैं (`SessionFormatUnsupportedError`)। वितरित `scripts/repair-session-logs.mjs` केवल लक्षित ऑडिट पंक्तियों को `ignorable: true` ले जाने के लिए फिर से लिखता है, फ़्रेम-संरक्षित, बैकअप सहित:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # विदेशी पंक्तियों की रिपोर्ट, कुछ नहीं बदलता
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
```

`--home` डिफ़ॉल्ट रूप से `$DSH_HOME/sessions` (या `~/.dsh/sessions`)।

## Development

```sh
pnpm install            # node ^22.19 || >=24
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 236 tests, 20 files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # five-language README sync gate (also in CI)
```

हेडलेस एंड-टू-एंड सत्यापन रिकॉर्ड के लिए [VERIFICATION.md](VERIFICATION.md) देखें।

## Topics

`dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## Contributors

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: नियम शब्दावली व मूल्यांकन, runtime, HMR निगरानी, सत्र-लॉग ऑडिट, नेटवर्क नीति + प्रॉक्सी, और पाँच-भाषा दस्तावेज़।
- [@22xuan](https://github.com/22xuan) — rc.6 hosts द्वारा ऑडिट घटना के `ignorable` मार्कर को चुपचाप छोड़ने की विस्तृत रिपोर्ट ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) और अपस्ट्रीम harness चर्चा; v0.4.1 runtime host-क्षमता पहचान और दस्तावेज़ सुधार सीधे उसी विश्लेषण से निकले।
- [@sjh9714](https://github.com/sjh9714) — साझा नियम-सिंटैक्स टेस्ट-वेक्टर कॉर्पस प्रस्तावित किया ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), जो v0.5.1 में `docs/rule-test-vectors/` के रूप में शामिल हुआ, और [डिज़ाइन चर्चा](https://github.com/PerryLink/dsh-permission-rules/discussions/10) में AST-विघटन के सीमा-मामले दिए।
- [@weipeng1999](https://github.com/weipeng1999) — AST-आधारित कमांड-विघटन फ़ीचर प्रस्ताव ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)), जिससे डिज़ाइन चर्चा शुरू हुई।
- [@alexchenzl](https://github.com/alexchenzl) — DSH Directory में सूचीबद्ध करने का अनुरोध ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7))।
- [@zl190](https://github.com/zl190) — `0.1.0-rc.7` harness संगतता अंतर की सूचना दी और उसे सत्यापित किया ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9))।

## PerryLink DSH Plugin Family

यह परियोजना [PerryLink](https://github.com/PerryLink) द्वारा अनुरक्षित [15 DeepSeek Harness प्लगइन](https://github.com/PerryLink) में से एक है। यदि यह आपकी मदद करता है, तो बाकी भी संभवतः करेंगे:

| Plugin | One-liner |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Engineering-discipline guard: requirements grill, test gates, adversary review |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Durable background child agents with a Web UI sidebar, messaging and interrupt |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | LSP diagnostics, formatting, completion, code actions and rename over language servers |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Claude Code outputStyles-equivalent runtime style switching |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit |
| [dsh-auto-review](https://github.com/PerryLink/dsh-auto-review) | Second-model auto-review on the approval chain, fail-closed by default |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Security-audit skill pack: secret scan, dependency and supply-chain review |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Pin sessions in the Web sidebar with durable ordering |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Terminal-style input history for the web composer: arrows, Ctrl+R search |
| [dsh-github](https://github.com/PerryLink/dsh-github) | GitHub PR/issues integration for DSH, every write gated by approval |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Plugin-development knowledge base as an on-demand agent skill |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH |

## License

[Apache License 2.0](LICENSE) © 2026 dsh-permission-rules contributors
