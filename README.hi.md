<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-permission-rules-hero-en-dark.webp">
  <img src="docs/assets/dsh-permission-rules-hero-en-light.webp" width="100%" alt="dsh-permission-rules का निर्णय लेजर: क्रमबद्ध नियम श्रृंखला का पहला मेल, उसका deny निर्णय कार्ड, और शेल आउटबाउंड के लिए प्रॉक्सी पट्टी">
</picture>

# dsh-permission-rules

**टूल कॉल पर फ़ैसले का अधिकार अपने हाथ में लें — हर allow / deny / ask YAML में रहता है: निर्धारक, तत्काल और ऑडिट-योग्य।**

DeepSeek Harness के लिए Claude Code शैली का डिक्लेरेटिव परमिशन मिडलवेयर: नियम ज्ञात को तय करते हैं और समीक्षक मॉडल अज्ञात को; साथ में Codex शैली की प्रोसेस-स्तरीय नेटवर्क नीति और स्थानीय प्रॉक्सी है जो शेल सबप्रोसेस की आउटबाउंड ट्रैफ़िक को नियंत्रित करती है।

[इंस्टॉल](#तीन-चरणों-में-शुरुआत) · [कॉन्फ़िगरेशन](#कॉन्फ़िगरेशन) · [FAQ](#faq) · [简体中文](README.md) · [English](README.en.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

[![License](https://img.shields.io/badge/license-Apache--2.0-3366CC?style=flat-square&labelColor=2B3245)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.2%20%3C0.3.0-4B67B4?style=flat-square&labelColor=2B3245)](#संगतता)
[![npm](https://img.shields.io/npm/v/dsh-permission-rules?style=flat-square&labelColor=2B3245&color=CB3837)](https://www.npmjs.com/package/dsh-permission-rules)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-permission-rules/ci.yml?branch=main&label=CI&style=flat-square&labelColor=2B3245)](https://github.com/PerryLink/dsh-permission-rules/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24.9-339933?style=flat-square&labelColor=2B3245)](#संगतता)

[![Stars](https://img.shields.io/github/stars/PerryLink/dsh-permission-rules?style=flat-square&labelColor=2B3245)](https://github.com/PerryLink/dsh-permission-rules/stargazers)
[![npm downloads](https://img.shields.io/npm/dm/dsh-permission-rules?style=flat-square&labelColor=2B3245&color=CB3837)](https://www.npmjs.com/package/dsh-permission-rules)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-permission-rules?metric=downloads)](https://dshfind.com/plugins/PerryLink/dsh-permission-rules?ref=badge)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/PerryLink/dsh-permission-rules/badge)](https://securityscorecards.dev/viewer/?uri=github.com/PerryLink/dsh-permission-rules)
[![DSH Market](https://img.shields.io/badge/DSH_Market-listed-4B67B4?style=flat-square&labelColor=2B3245)](https://dsh.market/)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-C71D23?style=flat-square&labelColor=2B3245&logo=gitee)](https://gitee.com/perrylink/dsh-permission-rules)

```sh
dsh plugin --profile <name> add dsh-permission-rules
```

</div>

<sub>सामुदायिक प्लगइन, DeepSeek से संबद्ध नहीं। आधिकारिक रेपो: <https://github.com/PerryLink/dsh-permission-rules> (Gitee एक मिरर है)।</sub>

## यह क्या है

`dsh-permission-rules` हर टूल कॉल से पहले `tools/pre-execute` waterfall पर **`allow` / `deny` / `ask`** नियमों की क्रमबद्ध सूची रखता है — निर्धारक, तत्काल, ऑडिट-योग्य और आपके द्वारा शुद्ध YAML में लिखी गई। नियम ज्ञात कॉल तय करते हैं; अनिश्चित कॉल आधिकारिक approval seam पर जाती हैं, जहाँ समीक्षक मॉडल या इंसान उत्तर देता है। दूसरी परत Codex शैली की प्रोसेस-स्तरीय नेटवर्क नीति जोड़ती है: शेल सबप्रोसेस की आउटबाउंड ट्रैफ़िक अंतर्निहित स्थानीय HTTP/CONNECT प्रॉक्सी से गुज़रती है, जिसे नेटवर्क नियम या आधिकारिक sandbox presets पर मैप किए गए तीन मोड तय करते हैं।

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dsh-permission-rules-flow-v5-dark.svg">
  <img src="docs/assets/dsh-permission-rules-flow-v5-light.svg" width="100%" alt="dsh-permission-rules संरचना: टूल कॉल और शेल आउटबाउंड दो चैनल एक क्रमबद्ध नियम श्रृंखला में मिलते हैं, फिर टूल-कॉल और नेटवर्क-आउटबाउंड निर्णयों में बँटते हैं, और दो केवल-लॉग ऑडिट घटनाओं पर समाप्त होते हैं">
</picture>

*संरचना: दो चैनल (टूल कॉल / शेल आउटबाउंड) एक क्रमबद्ध नियम श्रृंखला में मिलते हैं — पहला मेल जीतता है — फिर टूल-कॉल और नेटवर्क-आउटबाउंड निर्णयों में बँटते हैं, और दो केवल-लॉग ऑडिट घटनाओं पर समाप्त होते हैं।*

## तीन चरणों में शुरुआत

1. **इंस्टॉल करें** (कोई एक चैनल चुनें):

   ```sh
   # git चैनल (नवीनतम main; prepare स्क्रिप्ट केवल production dependencies से बिल्ड करती है)
   dsh plugin --profile web add github:PerryLink/dsh-permission-rules
   # npm चैनल (प्रकाशित रिलीज़)
   dsh plugin --profile web add dsh-permission-rules
   # tarball चैनल: इस रेपो में pnpm pack, फिर
   dsh plugin --profile web add ./dsh-permission-rules-<version>.tgz
   ```

2. **अपना पहला नियम लिखें** (प्रोजेक्ट रूट में `.dsh/rules.yaml`; वैकल्पिक, अंतर्निहित उच्च-जोखिम बेसलाइन डिफ़ॉल्ट रूप से चालू है):

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

3. **जाँचें कि यह माउंट होता है**:

   ```sh
   # प्रोफ़ाइल रीस्टार्ट करने के बाद प्लगइन पंक्ति की पुष्टि करें
   dsh --profile web --dump-config | grep -A4 'id: permission-rules'
   # वास्तविक कमांड सतह पर एक काल्पनिक कॉल का शुष्क मूल्यांकन करें; कोई टूल नहीं चलता
   /rules test bash {"command":"git push origin main","cwd":"src/secrets/app"}
   ```

```text
"bash" matches rule 1 (deny): 禁止 push 到受保护路径
```

**अनइंस्टॉल**: `dsh plugin --profile web remove dsh-permission-rules` (या प्रोफ़ाइल patch से वह पंक्ति हटाएँ)।

<details>
<summary>DSH Desktop मार्केट से इंस्टॉल करें</summary>

हर PerryLink प्लगइन DSH Desktop के अंतर्निहित मार्केट में सूचीबद्ध है: **मार्केट → स्रोत → स्रोत जोड़ें → चिपकाएँ** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ चुनें**। इंस्टॉल के लिए अब भी मार्केट का npm पहचान सत्यापन और आपकी पुष्टि आवश्यक है।

</details>

## मुख्य क्षमताएँ

`dsh-permission-rules` `tools/pre-execute` पर हर टूल कॉल से पहले क्रमबद्ध नियम रखता है — निर्धारक, तत्काल, ऑडिट-योग्य:

- **`deny`** कॉल को रोकता है; नियम का `reason` मॉडल को दिखने वाली त्रुटि बन जाता है।
- **`ask`** आधिकारिक approval seam से जाता है (`dsh-auto-review` माउंट करें तो दूसरा मॉडल उत्तर देता है, या इंसान उत्तर देता है; दोनों न हों तो harness fail closed होता है)।
- **`allow`** (और कोई मेल न होना) सख्ती से `next()` से प्रत्यायोजित होता है — डाउनस्ट्रीम listeners कभी short-circuit नहीं होते।

हर हिट **और** हर passthrough `permissionRules/decision` सत्र ईवेंट के रूप में ऑडिट-लॉग होता है (केवल लॉग — मॉडल संदर्भ में कुछ अतिरिक्त नहीं डाला जाता)। हिट पंक्तियाँ स्थिर `ruleId` रखती हैं (स्पष्ट `id` या `auto:<16 hex>` सामग्री-फ़िंगरप्रिंट; `ruleIndex` बना रहता है); passthrough पंक्तियाँ `passthroughReason` रखती हैं (`no-match` / `rules-not-loaded` / `out-of-scope`), ताकि सत्र- और होस्ट-पार का लेजर प्रति-नियम निर्णय एकत्र कर सके और सामान्य ट्रैफ़िक को गिरी हुई नीति से अलग पहचान सके।

- **समृद्ध मिलान** — टूल-नाम globs (`mcp__*` सहित), agent-identity चयनकर्ता (`main` / `subagent` / `preset:*`), argument key/value globs **या** regexes (`!pattern` निषेध और `absent` key आयाम सहित), **किसी भी नेस्टिंग गहराई** पर workspace-सापेक्ष path globs, `when` होस्ट शर्तें (env वेरिएबल, प्लेटफ़ॉर्म), और token-सटीक कमांड मिलान के लिए **शेल कमांड विघटन** (`argv`: कमांड शब्द, argument tokens, pipeline signature)।
- **अंतर्निहित उच्च-जोखिम बेसलाइन** — शिप किया गया deny/ask नियम-सेट (विनाशकारी कमांड, privilege escalation, download-and-execute, संवेदनशील paths) डिफ़ॉल्ट रूप से सक्षम और उपयोगकर्ता नियमों के बाद जोड़ा गया, ताकि निकटतर उपयोगकर्ता नियम उसे ओवरराइड कर सके; `builtin.enabled` से टॉगल करें।
- **पदानुक्रमित नियम फ़ाइलें** — वैकल्पिक `searchUp` सत्र cwd से फ़ाइलसिस्टम रूट तक हर `.dsh/rules.yaml` को मिलाता है, निकटतम पहले।
- **ड्राई-रन रोलआउट** — `enforce: false` ऑडिट करता है कि नीति *क्या* करती, जबकि हर कॉल पास हो जाती है।
- **हॉट रीलोड** — debounce के साथ Chokidar watch; फ़ाइल-स्तर पर टूटा संपादन पिछले नियम रखता है और कभी क्रैश नहीं करता, जबकि एक अमान्य नियम केवल स्वयं अक्षम होता है। WSL होस्ट पर, या `/mnt/<drive>` के अंतर्गत नियम फ़ाइल के लिए, watch polling पर चला जाता है क्योंकि वहाँ native change events अविश्वसनीय हैं।
- **ज़ोर से, पर सीमित** — फ़ाइल-स्तरीय त्रुटियाँ (अमान्य YAML आदि) `badFilePolicy` का पालन करती हैं; एक अमान्य नियम (खराब glob/regex, अज्ञात फ़ील्ड/action) केवल स्वयं अक्षम होता है और स्टार्टअप व `/rules` में दिखता है, बाकी नियम काम करते रहते हैं (issue #49)।

### कमांड और टूल सतह

| सतह | प्रकार | टिप्पणियाँ |
|---|---|---|
| `tools/pre-execute` | listener | पहला मेल खाने वाला allow/deny/ask नियम + नेटवर्क URL-उम्मीदवार निष्कर्षण |
| `/rules` | command | `list` · `reload` · `decisions [n]` · `test <tool> <json>` |
| `permissionRules/decision` | event | हर हिट और passthrough का केवल-लॉग ऑडिट |
| `permissionRules/network` | event | अवरुद्ध कनेक्शनों का proxy-परत ऑडिट |
| HTTP/CONNECT proxy | service | शेल सबप्रोसेस ट्रैफ़िक नियंत्रित करने वाला अंतर्निहित स्थानीय proxy |
| settings page | client | नेटवर्क-मोड एडिटर, नियम एडिटर, ब्लॉक काउंटर, हाल की इंटरसेप्शन (प्रत्येक के लिए अनुमति क्रिया) |

```text
/rules                        list the active rules, their source files, and any last-reload error
/rules list                   explicit alias for the bare listing
/rules reload                 re-read the rule-file chain for this workspace
/rules decisions [n]          show the last n permission decisions of this session (default 10)
/rules test <tool> <json>     dry-evaluate the rules against a hypothetical call
```

`/rules test` आगे flags भी स्वीकार करता है: `--cwd <dir>`, `--env KEY=VALUE` (दोहराने योग्य), `--agent <selector>` (दोहराने योग्य) और `--platform <name>`। बहु-फ़ाइल श्रृंखलाओं में (जैसे `searchUp`), सूचीबद्ध हर नियम पंक्ति अपनी स्रोत फ़ाइल को दी जाती है।

### उदाहरण

ये प्लगइन के वास्तविक प्रवेश-बिंदु हैं; एक बार इंस्टॉल करें, फिर कोई एक कॉल करें।

**विस्तृत उदाहरण** — कमांड `/rules test bash {"command":"git push origin main","cwd":"src/secrets/app"}`, आउटपुट:

```text
"bash" matches rule 1 (deny): 禁止 push 到受保护路径
```

*Observed from `test/command.spec.ts:204-219 (assertions at :209-213); src/prose.ts:121`*

**विफलता शाखा** — इनपुट `/rules test bash {not json`, आउटपुट:

```text
Invalid JSON arguments "{not json": the arguments must parse as JSON.
```

*Observed from `plugins/dsh-permission-rules/src/prose.ts:123; plugins/dsh-permission-rules/src/runtime.ts:1266-1272; plugins/dsh-permission-rules/test/command.spec.ts:221-228`*

**संक्षिप्त उदाहरण**: `tools/pre-execute` · `/rules test <tool> <json>`

## नियम सिंटैक्स

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

- **मिलान आयाम** — `tools` (globs, `mcp__*` सहित), `agents` (`main` / `subagent` / `preset:<name>`; अज्ञात पहचान कभी नहीं मिलती — fail closed), `params` (key/value globs या regexes, `!pattern` निषेध, `absent` key आयाम), `paths` (किसी भी गहराई पर निकाले गए workspace-सापेक्ष globs), `when` (`env` var globs/regexes + बंद `platform` सूची), और `network` (`domains` / `ips` / `ports` / `schemes` — globs, wildcards, CIDRs, port ranges)।
- **क्रियाएँ** — `allow` / `deny` / `ask`, फ़ाइल क्रम में मूल्यांकित, पहला मेल जीतता है।
- **नियम मेटाडेटा** — `enabled: false` (दिखता है पर निष्क्रिय), `description`, `tags`; अज्ञात फ़ील्ड लोड पर विफल होते हैं।
- **Schema** — JSON Schema [docs/rules-format.schema.json](docs/rules-format.schema.json) पर (एडिटर पूर्णता `# yaml-language-server: $schema=...` से); पूरी शब्दावली और 5-नियम सुरक्षा बेसलाइन [docs/rules-format.en.md](docs/rules-format.en.md) में है।

## नेटवर्क नीति

Codex शैली की **प्रोसेस-स्तरीय नेटवर्क नीति**: शेल सबप्रोसेस ट्रैफ़िक अंतर्निहित स्थानीय **HTTP/CONNECT proxy** से गुज़रता है, और हर कनेक्शन क्रमबद्ध नेटवर्क नियमों या आधिकारिक sandbox presets पर मैप किए गए तीन मोड से तय होता है:

- **`deny-all`** — read-only sandbox preset: सभी आउटबाउंड रोकें।
- **`whitelist`** — workspace-write preset: सूचीबद्ध लक्ष्यों को अनुमति, बाकी के लिए `unlisted: ask` (या `deny`)।
- **`allow-all`** — danger-full-access preset: सब कुछ अनुमति।
- **`auto`** (डिफ़ॉल्ट) — sandbox preset का अनुसरण करता है; sandbox-policy सेवा न होने वाले होस्ट पर `autoFallback` (`allow-all`) में बदल जाता है।

- **मिलान** — `match.network` में `domains` / `ips` / `ports` / `schemes` (globs, wildcards, CIDRs, port ranges; संख्यात्मक YAML ports स्वीकार्य)। `tools/pre-execute` हॉट पथ पर URL-उम्मीदवार निष्कर्षण web-टूल arguments और bash/pwsh कमांड टेक्स्ट में अंतर्निहित URLs पर चलता है; loopback लक्ष्य `loopback` नीति के अनुसार नियमों को short-circuit कर सकते हैं। IPv4-मैप किए गए IPv6 literals मिलान से पहले अपने IPv4 रूप में सामान्यीकृत होते हैं, और proxy उन्हीं पतों पर जुड़ता है जिन पर निर्णय हुआ — कभी दूसरा DNS resolution नहीं — जिस कनेक्शन के adjudication में कोई पता नहीं मिला वह नाम डायल करने के बजाय fail closed (502) होता है।
- **अपस्ट्रीम चेनिंग** — `network.upstreamProxy` (डिफ़ॉल्ट `off`) इस proxy द्वारा **अनुमत** कनेक्शनों को upstream proxy से भेजता है: CONNECT upstream से tunnel माँगता है (`CONNECT host:port`) और सादे HTTP अनुरोध absolute रूप में उसे अग्रेषित होते हैं। अवरुद्ध लक्ष्य कभी upstream तक नहीं पहुँचता — उसे अब भी इस प्लगइन का संरचित 403 मिलता है। upstream कॉन्फ़िगर होने पर भी दो स्थितियाँ कभी चेन नहीं होतीं: **loopback** लक्ष्य (इस होस्ट के बाहर का proxy उसका loopback रूट नहीं कर सकता) और **`ips`-स्कोप नियम** से उत्पन्न कोई भी निर्णय (चेनिंग hostname upstream को सौंप देती है, इसलिए "कनेक्शन उसी पते पर पड़ता है जो नियमों ने देखा" — issue #21 — ठीक वहाँ टूट जाएगा जहाँ नियमों को पते की परवाह थी; वे निर्णय adjudicated पते पर सीधे डायल करते रहते हैं), साथ ही वह लक्ष्य जिसके scheme के लिए कोई उपयोगी upstream नहीं। upstream का अपना hostname ऑपरेटर कॉन्फ़िगरेशन है, agent इनपुट नहीं, और इन नियमों से adjudicate नहीं होता। credentials वाला URL कभी कच्चा नहीं छापा जाता: चेतावनियाँ, `/rules network` और settings snapshot पासवर्ड मास्क करते हैं (`http://user:***@host:port`)। upstream अनुपलब्ध, timeout (10 s), या non-2xx उत्तर **502** देता है — जानबूझकर सीधे डायल पर चुपचाप fallback नहीं, ताकि गलत कॉन्फ़िगरेशन दिखता रहे।
- **ऑडिट** — अस्वीकृत कनेक्शन स्वामी सत्र में `permissionRules/network` जोड़ते हैं (वही अनुकूली `ignorable` द्वार), ब्लॉक काउंटर और हाल की इंटरसेप्शन `/rules network` और settings पेज में।
- **निदान** — अवरुद्ध कनेक्शन `[network: …]` संदेश लेकर आते हैं जो अवरुद्ध लक्ष्य, निर्णय देने वाला मोड या नियम, और उपाय बताता है।
- **settings पेज से अनुमति** — हर हाल की इंटरसेप्शन एक **Allow** क्रिया देती है। यह उस निकटतम नियम फ़ाइल के **शीर्ष** (index 0) पर एक न्यूनतम `match: { network: { domains: [<host>] } }` / `action: allow` नियम लिखती है जो वास्तव में उस कनेक्शन का निर्णय करती है: जिस workspace को ब्लॉक आरोपित हुआ उसकी प्रोजेक्ट फ़ाइल (कॉन्फ़िगर होने पर absolute `rulesFile`), या session-रहित host-स्तरीय ब्लॉक के लिए वह फ़ाइल जो host chain हल करती है (absolute `rulesFile` → मौजूदा `<processCwd>/<rulesFile>` → कॉन्फ़िगर `fallbackPath` → `<processCwd>/<rulesFile>`, बनाई जाती है) — और जब कई workspaces लोड हों, पेज पहले picker देता है, क्योंकि कोई भी लोडेड workspace chain host chain से ऊपर है। index 0 इसलिए क्योंकि नियम first-match-wins हैं: मौजूदा `deny` के बाद जोड़ा नियम मृत पाठ होगा। केवल `domains`, क्योंकि वह आयाम subdomain-समावेशी और port/scheme-निरपेक्ष है, इसलिए host अगले port पर दोबारा अवरुद्ध नहीं होता; मौजूदा टिप्पणियाँ और अछूते नियम बचे रहते हैं, और पाठ hand edit जैसे ही validation द्वार से गुज़रता है। बदलाव तुरंत लागू होता है — cached workspace chains **और** session-रहित host chain दोनों फिर पढ़ी जाती हैं, न restart न `/rules reload` — और निर्णय फिर गणना होता है, इसलिए सूचना वास्तविक परिणाम बताती है और कनेक्शन अवरुद्ध रहने पर कभी सफलता का दावा नहीं करती। यह अज्ञात workspace, ज्ञात नियम स्रोतों के बाहर का लक्ष्य, read-only अंतर्निहित बेसलाइन, और ऐसी फ़ाइल जिसे पढ़ा या parse नहीं कर सकता — इन्हें फ़ाइल अछूती छोड़कर अस्वीकार करता है; पहले से अनुमत कनेक्शन कुछ नहीं लिखता। `network.allowHostAction: false` बटन छिपाता है और RPC को अस्वीकार कराता है।

## कॉन्फ़िगरेशन

सभी tunables Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। id-लक्षित override पूरी पंक्ति बदल देता है — ज़रूरी हर key दोहराएँ। `0.1.7-alpha` होस्ट पर हर फ़ील्ड `.volatile()` घोषित है, इसलिए Plugins settings पेज से जगह पर भी संपादित हो सकता है: संपादन चल रहे references में बिना प्लगइन remount किए commit होता है, runtime अगले उपयोग पर नया मान पढ़ता है, और `network.proxyPort`, `proxyBind`, `injectEnv` या `noProxy` बदलने पर स्थानीय proxy तुरंत rebind होता है। संख्यात्मक सीमाएँ schema में हैं, और config editor persist करने से पहले merged config को उसी schema से resolve करता है, इसलिए सीमा-बाहर मान लिखते समय अस्वीकृत होता है। जिन होस्ट का Schemastery `volatile()` से पुराना है, वहाँ ये फ़ील्ड केवल cordis.yml से बदलते हैं।

सबसे अधिक उपयोग होने वाली keys:

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | नियम फ़ाइल का स्थान; सापेक्ष = कॉल करने वाले सत्र के cwd से resolve, absolute = वैश्विक और माउंट पर सत्यापित |
| `fallbackPath` | *(none)* | cwd-आधारित खोज कुछ न मिलने पर उपयोग होने वाली नियम फ़ाइल; माउंट पर सत्यापित |
| `badFilePolicy` | `fail` | फ़ाइल-स्तरीय विफलता: `fail` लंबित टूल कॉल को ज़ोर से विफल करता है; `ignore-with-warning` चेतावनी देकर खाली आगे बढ़ता है। एक अमान्य नियम हमेशा अलग रहता है: वह नियम अक्षम होकर स्टार्टअप व `/rules` में रिपोर्ट होता है |
| `maxRules` | `256` | प्रभावी स्रोत श्रृंखला पर नियम संख्या की कठोर सीमा |
| `patternMode` | `glob` | `params`/`paths`/`when.env` pattern शैली: `glob` या `regex` (टूल नाम सदा globs) |
| `watch` | `true` | Chokidar watch + बदलाव पर रीलोड |
| `enforce` | `true` | `false` = ड्राई-रन: deny/ask हिट `dryRun` चिह्न के साथ ऑडिट होते हैं और हर कॉल पास होती है |
| `language` | `en` | `/rules` आउटपुट भाषा: `en`, `zh`, `es`, `pt`, `hi` |

<details>
<summary>पूर्ण कॉन्फ़िगरेशन तालिका (29 keys)</summary>

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `rulesFile` | `.dsh/rules.yaml` | नियम फ़ाइल का स्थान; सापेक्ष = कॉल करने वाले सत्र के cwd से resolve, absolute = वैश्विक और माउंट पर सत्यापित |
| `fallbackPath` | *(none)* | cwd-आधारित खोज कुछ न मिलने पर उपयोग होने वाली नियम फ़ाइल; माउंट पर सत्यापित |
| `badFilePolicy` | `fail` | फ़ाइल-स्तरीय विफलता: `fail` लंबित टूल कॉल को ज़ोर से विफल करता है; `ignore-with-warning` चेतावनी देकर खाली आगे बढ़ता है। एक अमान्य नियम हमेशा अलग रहता है: वह नियम अक्षम होकर स्टार्टअप व `/rules` में रिपोर्ट होता है |
| `maxRules` | `256` | प्रभावी स्रोत श्रृंखला पर नियम संख्या की कठोर सीमा |
| `maxCachedWorkspaces` | `512` | cached प्रति-workspace नियम लोड की कठोर सीमा (LRU eviction) |
| `patternMode` | `glob` | `params`/`paths`/`when.env` pattern शैली: `glob` या `regex` (टूल नाम सदा globs) |
| `watch` | `true` | Chokidar watch + बदलाव पर रीलोड |
| `watchStabilityThresholdMs` | `200` | रीलोड debounce विंडो (ms) |
| `language` | `en` | `/rules` आउटपुट भाषा: `en`, `zh`, `es`, `pt`, `hi` |
| `caseInsensitivePaths` | *(win32)* | `paths` patterns और workspace-root तुलना ASCII केस अनदेखा करते हैं; Windows पर `true` |
| `audit` | `all` | ऑडिट ग्रैन्युलैरिटी: `all` हर हिट और passthrough लॉग करता है; `hits` passthrough छोड़ता है |
| `searchUp` | `false` | सत्र cwd से पैरेंट डायरेक्टरीज़ में जाकर हर मिली नियम फ़ाइल मिलाएँ, निकटतम पहले |
| `maxGlobStars` | `2` | प्रति glob pattern unbounded `*`/`**` quantifiers की कठोर सीमा |
| `enforce` | `true` | `false` = ड्राई-रन: deny/ask हिट `dryRun` चिह्न के साथ ऑडिट होते हैं और हर कॉल पास होती है |
| `allowUnmarkedAudit` | `false` | pre-marker होस्ट `ignorable` चिह्न छोड़ देते हैं; प्लगइन चेतावनी के साथ session-log ऑडिट बंद करता है। फिर चालू करने के लिए `true` |
| `network.enabled` | `true` | proxy, env injection, और web-tool mode defaults का मास्टर स्विच |
| `network.mode` | `auto` | नीति मोड: `auto` sandbox preset का अनुसरण करता है, या `deny-all` / `whitelist` / `allow-all` |
| `network.autoFallback` | `allow-all` | जब `auto` के पास sandbox-policy सेवा न हो तब प्रयुक्त मोड |
| `network.unlisted` | `ask` | whitelist मोड में बिना मेल वाले लक्ष्यों का व्यवहार: `ask` या `deny` |
| `network.proxyBind` | `127.0.0.1` | स्थानीय proxy bind पता (केवल loopback) |
| `network.proxyPort` | `0` | स्थानीय proxy port; `0` मुक्त ephemeral port चुनता है |
| `network.proxyMaxRecent` | `100` | settings पेज के लिए रखे हाल के block रिकॉर्ड की सीमा |
| `network.loopback` | `allow` | loopback लक्ष्य: `allow` (Codex समानता) या `policy` |
| `network.injectEnv` | `true` | सबप्रोसेस के लिए proxy env वेरिएबल इंजेक्ट हों या नहीं |
| `network.noProxy` | `clear` | सबप्रोसेस NO_PROXY व्यवहार: `clear` नीति लागू करता है या `preserve` |
| `network.upstreamProxy` | `off` | इस प्लगइन द्वारा **अनुमत** कनेक्शनों के लिए upstream proxy: `off` सीधे डायल, `inherit` launch environment के proxy नाम पुनः उपयोग, या स्पष्ट `http(s)://` proxy URL |
| `network.allowHostAction` | `true` | settings पेज की प्रति-ब्लॉक "इस होस्ट को अनुमति" क्रिया: `false` Allow बटन छिपाता है और `permissionRules/allowHost` RPC अस्वीकार कराता है (नियम एडिटर प्रभावित नहीं) |
| `builtin.enabled` | `true` | अंतर्निहित उच्च-जोखिम बेसलाइन: `false` शिप किया गया deny/ask सेट पूरी तरह बंद करता है |
| `builtin.path` | *(शिप किया गया)* | प्रतिस्थापन बेसलाइन फ़ाइल (absolute, या `process.cwd()` के सापेक्ष); माउंट पर सत्यापित |

</details>

## FAQ

<details>
<summary>नियम फ़ाइलें कहाँ रहती हैं? क्या प्लगइन मेरी फ़ाइलों में लिखेगा?</summary>

नियम डिस्क से पढ़े जाते हैं: प्रोजेक्ट रूट का `.dsh/rules.yaml`, या कॉन्फ़िगर किया गया `rulesFile` / `fallbackPath`, `searchUp` में ऊपर की ओर मिलाए जाते हैं। सामान्य adjudication पथ कोई नियम डेटा नहीं लिखता। लेखन की केवल दो सतहें हैं: settings पेज का नियम एडिटर और "Allow" क्रिया — बाद वाली ज्ञात नियम स्रोत के शीर्ष पर एक न्यूनतम allow नियम लिखती है और hand edit जैसी ही parse/compile जाँच से गुज़रती है (देखें "नेटवर्क नीति")।

</details>

<details>
<summary>dsh-auto-review माउंट न हो तो ask का क्या होता है?</summary>

`ask` आधिकारिक approval seam से जाता है: `dsh-auto-review` माउंट हो तो read-only दूसरा मॉडल उत्तर देता है; नहीं तो इंसान; दोनों न हों तो harness fail closed होता है और कॉल कभी चुपचाप अनुमत नहीं होती। यह प्लगइन स्वयं कभी subagents नहीं बनाता और मॉडल नहीं बुलाता — `ask` निर्णय देना उसके काम का अंत है।

</details>

<details>
<summary>क्या यह proxy होस्ट के अपने आउटबाउंड अनुरोधों को रोकता है?</summary>

नहीं। इंजेक्ट किया गया proxy environment **बनाए गए shell children** और अनुरोध के समय proxy नाम पढ़ने वाले किसी भी consumer को कवर करता है। यह होस्ट प्रोसेस के अपने `fetch`-आधारित ट्रैफ़िक को **नहीं** कवर करता: launcher पहले प्लगइन माउंट होने से पहले launch environment से undici का वैश्विक dispatcher स्थापित करता है, वह dispatcher environment से नहीं बल्कि अपनी नीति से रूट करता है। इसलिए provider endpoints को allow नियम की ज़रूरत **नहीं**, और `network.injectEnv: false` होस्ट प्रोसेस को किसी चीज़ से बाहर नहीं करता। 2026-09-10 को Node 22 पर मापा गया; `scripts/host-egress-probe.mjs` से दोहराएँ।

</details>

<details>
<summary>हॉट पथ पर प्रदर्शन लागत कितनी है?</summary>

नियम मूल्यांकन इन-मेमोरी first-match traversal है — कोई मॉडल कॉल नहीं, कोई नेटवर्क अनुरोध नहीं; हिट और passthrough केवल session audit जोड़ते हैं। विफल watch चेतावनी देकर पिछले नियम रखता है। बड़े नियम सेट के लिए `audit: hits` से passthrough छोड़ें, या `maxRules` / `maxCachedWorkspaces` से लोड सीमित करें।

</details>

<details>
<summary>क्या यह अन्य प्लगइनों से events, command नाम या slots पर टकराता है?</summary>

नहीं। टूल नाम namespaced हैं और कोई bare नाम नहीं लिया जाता; सेवा keys `permissionRules` / `permissionRulesRuntime` कोई अंतर्निहित seam नहीं हैं और किसी सर्वेक्षित high-star प्लगइन में नहीं मिलतीं; यह client slot या `webServer` prefix पंजीकृत नहीं करता, और इसका patch केवल अपनी पंक्ति `insert` करता है; साझा events सदा `next()` से प्रत्यायोजित होते हैं। बिंदु-दर-बिंदु तर्क "अन्य DSH प्लगइनों के साथ इंटरऑपरेबिलिटी" में है।

</details>

## सुरक्षा सीमाएँ

- **नीति, kernel नहीं।** `paths` उम्मीदवार केवल documented argument keys के सेट से आते हैं (किसी भी नेस्टिंग गहराई पर, गहराई-सीमित), और केवल workspace-सापेक्ष paths मेल खाते हैं।
- **यहाँ कोई समीक्षक नहीं।** प्लगइन कभी subagents नहीं बनाता और मॉडल नहीं बुलाता — `ask` निर्णय देना उसके काम का अंत है।
- **कोई sandbox परिवर्तन नहीं।** OS-स्तरीय sandbox नीति sandbox seam की है, इस प्लगइन की नहीं।
- **ज़ोर से गलत कॉन्फ़िगरेशन।** अज्ञात YAML फ़ील्ड, अज्ञात actions और खराब patterns लोड पर अस्वीकृत होते हैं।
- **Backtracking सीमाएँ।** Glob patterns `maxGlobStars` तक सीमित unbounded star expansions रखते हैं; regex-mode patterns nested unbounded quantifiers और quantified overlapping literal alternations अस्वीकार करते हैं।
- **Fail-closed डायलिंग।** सादे HTTP forwards और CONNECT tunnels केवल adjudicated पतों पर जुड़ते हैं; जिस allow के adjudication में कोई पता नहीं मिला वह नाम डायल करने के बजाय 502 के साथ fail closed होता है (issue #23)।

## अनुमतियाँ और डेटा

- **Permissions**: workshop manifest में `files:read`, `files:watch`, `files:write`, `session:append` और `network:outbound` घोषित करता है। `ask` निर्णय आधिकारिक approval seam से जाते हैं — कुछ भी पुनः लागू या bypass नहीं होता।
- **Data**: नियम फ़ाइलें डिस्क से पढ़ी जाती हैं; सामान्य adjudication कोई नियम डेटा नहीं लिखता — लेखन की केवल दो सतहें settings पेज का नियम एडिटर और "Allow" क्रिया हैं। कोई मॉडल कॉल नहीं, कोई समीक्षक subagent नहीं।
- **Session log**: `permissionRules/decision` कभी मॉडल संदर्भ में नहीं डाला जाता और envelope के `ignorable: true` चिह्न के साथ जोड़ा जाता है, ताकि कोई भी harness build लॉग लोड कर सके।

## ज्ञात सीमाएँ

- **pre-marker और अस्वीकारक होस्ट पर ऑडिट चिह्न।** `permissionRules/decision` `ignorable: true` के साथ जोड़ा जाता है; जिन होस्ट का `Session.append` चिह्न से पुराना है (`0.1.0-rc.1`–`rc.7` और `0.1.1-rc.1`–`rc.7` लाइनें) वे इसे चुपचाप छोड़ देते हैं, `0.1.2-rc` लाइन alpha.5 सतह लाती है (कोई append विकल्प चिह्न नहीं लिख सकता), `0.1.2-alpha` लाइन पढ़ते समय चिह्नित plugin events भी अस्वीकार करती है, और `0.1.3-alpha` व `0.1.5-alpha` लाइनें वही surface-only append signature रखती हैं (प्रकाशित `0.1.3-alpha.1`/`0.1.5-alpha.1` पैकेजों पर सत्यापित) — runtime पहले append से पहले इन सभी की पूर्व-जाँच करता है और एक-बार की चेतावनी के साथ session-log ऑडिट बंद करता है। पीढ़ी-पार migration भी चिह्नित audit rows अस्वीकार करती है: `0.1.3-alpha` का v1→v2 द्वार अज्ञात v1 events अस्वीकार करता है, और `0.1.5-alpha` का v2→v3 द्वार हर unclassified event अस्वीकार करता है (उसकी सूची प्रकाशित v2 शब्दावली पर फ़्रोज़न है), इसलिए 0.1.3 होस्ट के लॉग खोलने से पहले v1 rows और 0.1.5 होस्ट पर अपग्रेड से पहले v2 rows का `strip` करें। Native v3 logs चिह्नित plugin rows स्वीकार करते हैं, इसलिए उन्हें केवल `repair` चाहिए। फिर चालू करने के लिए `allowUnmarkedAudit: true`; पहले से लिखे logs `scripts/repair-session-logs.mjs` से ठीक करें (जहाँ चिह्न मदद नहीं कर सकता वहाँ उसका `strip` मोड audit rows हटाता है)।
- **Path उम्मीदवार heuristic हैं।** केवल documented argument keys path मिलान में जाते हैं, और workspace-सापेक्ष मिलान केवल `caseInsensitivePaths` चालू होने पर ASCII case अनदेखा करता है।
- **Globs रूढ़िवादी उपसमुच्चय हैं।** कोई brace expansion नहीं — दो patterns लिखें, या regex मोड उपयोग करें।
- **Regex backtracking guard संरचनात्मक है, नितांत नहीं।** अविश्वसनीय फ़ाइलों के लिए glob मोड पसंद करें।
- **होस्ट के अपने आउटबाउंड अनुरोध इस proxy से नहीं गुज़रते।** इंजेक्ट किया गया proxy environment **बनाए गए shell children** — जो injection का उद्देश्य है — और अनुरोध के समय proxy नाम पढ़ने वाले किसी भी consumer को कवर करता है। यह होस्ट प्रोसेस के अपने `fetch`-आधारित ट्रैफ़िक को **नहीं** कवर करता: launcher पहले प्लगइन माउंट होने से पहले **launch environment** से undici का वैश्विक dispatcher स्थापित करता है, वह dispatcher environment से नहीं बल्कि अपनी नीति से रूट करता है, और Node शुरुआत में proxy environment का नमूना लेता है — इसलिए बाद में माउंट होने वाला प्लगइन उसे redirect नहीं कर सकता। परिणाम: provider endpoints को allow नियम की ज़रूरत **नहीं**, और `network.injectEnv: false` होस्ट प्रोसेस को किसी चीज़ से बाहर नहीं करता। 2026-09-10 को Node 22 पर मापा गया; `scripts/host-egress-probe.mjs` से दोहराएँ।
- **Upstream chaining केवल उसी को कवर करती है जो इस proxy तक पहुँचता है।** `dsh-v0.1.7-alpha.1` और बाद में, harness की अपनी launch-time proxy नीति और उसका subprocess environment overlay इस प्लगइन द्वारा इंजेक्ट किए proxy नामों से ऊपर हो सकते हैं, इसलिए `network.upstreamProxy` बताता है कि इस proxy द्वारा संभाले गए कनेक्शनों का क्या होता है — यह होस्ट प्रोसेस के हर आउटबाउंड पथ के बारे में दावा नहीं है।

## अन्य DSH प्लगइनों के साथ इंटरऑपरेबिलिटी

**DSH `0.2.0-rc.2`** (यह README जिस runtime के लिए है) और 2026-10-05 को सर्वेक्षित high-star प्लगइन सेट के विरुद्ध सत्यापित।

यह प्लगइन अन्य प्लगइनों में **हस्तक्षेप नहीं** करता, उन व्यापक रूप से इंस्टॉल high-star प्लगइनों में भी नहीं:

- **कोई tool-name टकराव नहीं।** हर टूल namespaced है; किसी shipped टूल या अन्य प्लगइन का कोई bare नाम पंजीकृत नहीं होता।
- **कोई service-key टकराव नहीं।** यह `permissionRules`, `permissionRulesRuntime` देता है; वे keys अंतर्निहित seam नहीं हैं और किसी सर्वेक्षित high-star प्लगइन में नहीं हैं।
- **कोई slot टकराव नहीं।** यह कोई client slot key पंजीकृत नहीं करता, इसलिए `shadows-shipped-ui` सीट के लिए नहीं लड़ता।
- **कोई HTTP route टकराव नहीं।** यह कोई `webServer` prefix पंजीकृत नहीं करता।
- **कोई patch-परत टकराव नहीं।** Bundle patch केवल अपनी पंक्ति `insert` करता है; अंतर्निहित पंक्ति का `config` कभी ओवरराइड नहीं करता।
- **कोई वैश्विक परिवर्तन नहीं।** यह prototypes नहीं बदलता, `process.env` नहीं लिखता, वैश्विक fetch dispatcher नहीं बदलता।

**साझा event listeners रचना से ही अहस्तक्षेपी हैं।** यह क्रम-संवेदी events `tools/post-execute`, `tools/pre-execute` को `ctx.on()` से सुनता है — Cordis का broadcast पंजीकरण, जहाँ हर listener चलता है और कोई किसी को भूखा नहीं मार सकता। **यहाँ हर listener `next()` से प्रत्यायोजित करता है**, इसलिए श्रृंखला कभी short-circuit नहीं होती, और mutation `next()` के उत्पादित मान पर लागू होता है, उसके स्थान पर लौटाए गए मान पर नहीं:

- `tools/post-execute` — also used by `cc-safety-net` (1576★).
- `tools/pre-execute` — also used by `cc-safety-net` (1576★).

स्थिर साक्ष्य: इस रेपो पर `dsh-plugin-doctor` के K10–K13 हर जाँच में `pass` रिपोर्ट करते हैं।

## dsh-auto-review के साथ सहयोग

- `dsh-permission-rules` `ask` उत्पन्न करता है; `dsh-auto-review` `approval/request` waterfall पर read-only दूसरे मॉडल का निर्णय देता है (या इंसानों को सौंपता है)। पूरा closed loop पाने के लिए दोनों माउंट करें।
- एकीकरण-परीक्षित: `permissionRules/decision` → `approval/asked` → `autoReview/verdict` → `approval/decided`, समीक्षक को scripted mock से बदलकर।
- आधिकारिक harness की `never` approval नीति और हर fail-closed गारंटी अछूती रहती है।

## सत्र लॉग मरम्मत

`ignorable` चिह्न से पहले लिखे सत्र लॉग नए harness builds द्वारा अस्वीकृत हो सकते हैं (`SessionFormatUnsupportedError`)। शिप किया गया `scripts/repair-session-logs.mjs` केवल लक्षित audit rows को `ignorable: true` लेकर फिर से लिखता है, frame सुरक्षित और backups के साथ:

```sh
node scripts/repair-session-logs.mjs scan [--home DIR]      # विदेशी rows रिपोर्ट करें, कुछ न बदलें
node scripts/repair-session-logs.mjs repair [--home DIR] [--dry-run]
node scripts/repair-session-logs.mjs strip [--home DIR] [--dry-run]
```

`--home` डिफ़ॉल्ट `$DSH_HOME/sessions` (या `~/.dsh/sessions`)। हर generation-addressed log अपने canonical basename से खोजा जाता है — `session.jsonl`, `session.v2.jsonl`, `session.v3.jsonl`, प्रत्येक वैकल्पिक रूप से `.zstd`-संपीड़ित — इसलिए generation के अनुसार मोड चुनें:

- **v3 (`session.v3.jsonl`, `0.1.5-alpha` लाइन द्वारा native रूप से लिखा)** — पढ़ने का पथ चिह्नित plugin rows स्वीकार करता है, इसलिए `repair` पर्याप्त है।
- **v2 (`session.v2.jsonl`, `0.1.3-alpha` लाइन द्वारा लिखा)** — `repair` इसे उस होस्ट पर खोलता है जिसने लिखा, लेकिन `0.1.5-alpha` की v2→v3 migration हर unclassified event अस्वीकार करती है, चिह्नित होने पर भी: `0.1.5-alpha` होस्ट पर अपग्रेड करने **से पहले** v2 logs पर `strip` चलाएँ।
- **v1 (`session.jsonl`)** — `0.1.3-alpha` की v1→v2 migration अज्ञात v1 events अस्वीकार करती है, चिह्नित होने पर भी: 0.1.3 या बाद के होस्ट द्वारा लॉग पहली बार खोलने से पहले `strip` चलाएँ।

## संगतता

| सतह | स्थिति |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-alpha.1` (2026-09-22 को अनुकूलित, पूरी gate श्रृंखला): इसका plugin config live settings अनुबंध है — हर फ़ील्ड `.volatile()` घोषित है, Loader `apply` को प्रति फ़ील्ड live reference देता है, और सहेजा संपादन बिना plugin remount किए चल रहे references में commit होता है, सीमा-बाहर मान कुछ लिखने से पहले schema द्वारा अस्वीकृत। जिन होस्ट का Schemastery `volatile()` से पुराना है (3.18.3 से पहले) वे भी इस प्लगइन को माउंट और चला सकते हैं — फ़ील्ड साधारण मान रह जाते हैं और live config फ़ॉर्म अनुपलब्ध रहता है — क्योंकि चिह्न मान लिया नहीं, capability probe से लगाया जाता है। इस लाइन का `Session.append` अब भी `ignorable` चिह्न नहीं लगा सकता (उसका तीसरा argument surface-intent बैग है, और envelope फ़ील्ड केवल stored-log पढ़ने के लिए बचता है), इसलिए पूरी `0.2-alpha` लाइन पहले append से पहले unmarked मानी जाती है और session-log ऑडिट डिफ़ॉल्ट रूप से बंद रहता है — `append` केवल `sourceEventSeqs`/`surfaceOp` पढ़ता है और envelope फ़्रीज़ करता है, इसलिए चिह्न लगाने का कोई code path नहीं; पहले की `0.1.7-alpha` (2026-09-22 अनुकूलित), `0.1.5-rc.2` (2026-09-09 अनुकूलित) और `0.1.3-alpha` लाइनें वही surface-only append signature रखती हैं, और हर `0.2` prerelease उन्हीं के साथ वर्गीकृत है (STABLE `0.2.x` release append probe को छोड़ी जाती है, इसलिए बहाल चिह्न सतह बिना नए plugin release के अपनाई जाती है)। उन लाइनों की log migrations unclassified plugin events अस्वीकार करती हैं, चिह्नित होने पर भी, इसलिए `0.1.3-alpha` होस्ट के लॉग खोलने से पहले v1 audit rows और `0.1.5-alpha` होस्ट द्वारा migrate करने से पहले v2 audit rows का `strip` करें (native v3 logs को केवल `repair` चाहिए)। |
| Node | `^22.19.0 || >=24.9.0` |
| प्लेटफ़ॉर्म | सभी (host + web settings client) |
| मॉडल | कोई भी (deny/ask कारण tool results से दिखते हैं) |

## इकोसिस्टम और गुणवत्ता

- [Gitee मिरर](https://gitee.com/perrylink/dsh-permission-rules) (सिंक मिरर; GitHub आधिकारिक है)
- [dshfind प्लगइन पेज](https://dshfind.com/plugins/PerryLink/dsh-permission-rules) (इंस्टॉल और रैंकिंग)
- [OpenSSF Scorecard रिपोर्ट](https://securityscorecards.dev/viewer/?uri=github.com/PerryLink/dsh-permission-rules) ([.github/workflows/scorecard.yml](.github/workflows/scorecard.yml) द्वारा संचालित)
- [dsh-plugin-doctor सत्यापन रिपोर्ट](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章) (K10–K13 सभी `pass`)
- [DSH Market](https://dsh.market/) (सूचीबद्ध)
- **1024 स्टोर चैनल**: एक बार `npm i -g dsh1024`, फिर `dsh1024 plugin --profile web add dsh-permission-rules` ([deepseek1024.com](https://deepseek1024.com) इंस्टॉल रैंकिंग में गिना जाता है)
- [इकोसिस्टम ज्ञान-आधार](https://perrylink.github.io/dsh-plugin-guide/): मापा डेटा, मार्केटिंग नहीं: प्लगइन विकास गाइड · प्लगइन-चयन डेटा · रखरखाव मानदंड

## डेवलपमेंट

```sh
pnpm install            # node ^22.19 || >=24.9
pnpm run typecheck      # tsc, src + tests
pnpm run lint           # eslint, src + tests + scripts
pnpm test               # vitest: 24 spec files
pnpm run test:coverage  # coverage gate (90/80/90/90)
pnpm run build          # tsc declarations + tsdown bundles (lib/)
pnpm run pack:check     # build + pack (the published artifact)
node scripts/check-readme-sync.mjs   # पाँच-भाषा README सिंक द्वार (CI में भी)
```

हेडलेस end-to-end सत्यापन रिकॉर्ड [VERIFICATION.md](VERIFICATION.md) में देखें। README चित्र [`scripts/gen-readme-assets.py`](scripts/gen-readme-assets.py) से प्रोग्रामेटिक रूप से बनते हैं (Pillow 1440×576 के zh/en और light/dark hero बैनर बनाता है; 1100×660 की हस्तलिखित dual-channel SVG संरचना आकृति है) और दोबारा चलाना सुरक्षित है।

Topics: `dsh`, `dsh-plugin`, `deepseek-harness`, `permission`, `policy`, `allow-deny-ask`, `approval`, `safety`, `network`, `network-policy`, `proxy`

## परिवार और आभार

यह प्रोजेक्ट [PerryLink](https://github.com/PerryLink) के DeepSeek Harness प्लगइन परिवार का हिस्सा है (सभी Apache-2.0)। अगर यह उपयोगी लगे, तो **एक स्टार अगले व्यक्ति को इसे खोजने में मदद करता है** — इसके पीछे कुछ भी लॉक नहीं है।

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: नियम शब्दावली और मूल्यांकन, runtime, HMR watch, session-log ऑडिट, नेटवर्क नीति + proxy, और पाँच-भाषा दस्तावेज़।
- [@am-i-dead](https://github.com/am-i-dead) — client-safe allow-host helpers को host-only मॉड्यूल से अलग किया (#24)।
- [@22xuan](https://github.com/22xuan) — rc.6 होस्ट द्वारा audit event का `ignorable` चिह्न चुपचाप छोड़े जाने की विस्तृत रिपोर्ट ([#2](https://github.com/PerryLink/dsh-permission-rules/issues/2)) और upstream harness चर्चा; v0.4.1 की runtime host-capability detection और दस्तावेज़ सुधार सीधे उसी विश्लेषण से आए।
- [@sjh9714](https://github.com/sjh9714) — साझा rule-syntax test-vector corpus प्रस्तावित किया ([#4](https://github.com/PerryLink/dsh-permission-rules/issues/4), [#5](https://github.com/PerryLink/dsh-permission-rules/issues/5)), v0.5.1 में `docs/rule-test-vectors/` के रूप में शिप हुआ, और [डिज़ाइन चर्चा](https://github.com/PerryLink/dsh-permission-rules/discussions/10) में AST-decomposition सीमा-मामले दिए।
- [@weipeng1999](https://github.com/weipeng1999) — AST-आधारित command-decomposition सुविधा प्रस्ताव ([#8](https://github.com/PerryLink/dsh-permission-rules/issues/8)), जिससे डिज़ाइन चर्चा बनी।
- [@alexchenzl](https://github.com/alexchenzl) — DSH Directory लिस्टिंग अनुरोध ([#7](https://github.com/PerryLink/dsh-permission-rules/issues/7))।
- [@zl190](https://github.com/zl190) — `0.1.0-rc.7` harness संगतता अंतराल की रिपोर्ट और सत्यापन ([PR #9](https://github.com/PerryLink/dsh-permission-rules/pulls/9))।
- [@cuohua](https://github.com/cuohua) — बताया कि version gate केवल `0.1.0` लाइन कवर करने पर भी `0.1.1-rc` लाइन `ignorable` चिह्न छोड़ती रही ([#11](https://github.com/PerryLink/dsh-permission-rules/issues/11)); चौड़ा किया गया gate सीधे उसी विश्लेषण से आया।

<details>
<summary>सभी प्लगइन विस्तृत करें</summary>

| प्लगइन | स्थिति |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** |  |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | 🚫 रिटायर्ड (रेपो संग्रहीत) |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | 🚫 रिटायर्ड (रेपो संग्रहीत) |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | 🚫 रिटायर्ड (रेपो संग्रहीत) |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** |  |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** |  |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | 🚫 रिटायर्ड (रेपो संग्रहीत) |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 फ़्रोज़न — रेपो README देखें |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 रिटायर्ड (रेपो संग्रहीत) |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 रिटायर्ड (रेपो संग्रहीत) |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 रिटायर्ड (रेपो संग्रहीत) |

</details>

## लाइसेंस

[LICENSE](LICENSE) (Apache License 2.0) © 2026 dsh-permission-rules contributors

<p align="center"><sub>Apache-2.0 · सामुदायिक प्लगइन, DeepSeek से असंबद्ध।</sub></p>
