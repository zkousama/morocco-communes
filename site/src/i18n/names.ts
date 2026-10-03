/**
 * The words on the page about douar names (components/docs/NamesPage.astro). Every number
 * on it is a {placeholder} filled from lib/naming.ts, and site/tests/naming.test.ts fails on
 * a digit typed here, but for the 2 of "both".
 */
export const names = {
  en: {
    title: "How douars get their Latin names",
    description:
      "Where each douar’s Latin name comes from: a source matched to HCP’s Arabic and tested against chance, or an engine that spells it from the Arabic.",
    lede: "HCP names all {douars} douars in Arabic only. Here’s where each Latin name on this site comes from.",
    found: "Found in a source",
    foundBody: "{sourced} names come from a source that writes them, each matched to HCP’s Arabic among the douars of its own commune.",
    sources: {
      education: "Ministry of Education school lists",
      osm: "OpenStreetMap",
      geonames: "GeoNames",
      visitors: "Visitors",
      spelt: "Spelt by the engine",
    },
    chance: "Tested against chance",
    chanceBody: "Every matching pass runs again with each commune swapped for another. Whatever it still finds is chance, and a pass over the line is thrown out.",
    chanceRows: { schools: "School lists", places: "Maps", near: "Maps, near douars already placed" },
    chanceLimit: "the line",
    engine: "Spelt by the engine",
    engineBody:
      "The other {spelt} are spelt from the Arabic, and show in italics. Both scripts come down to the same consonants for {keysMeet} of the names HCP gives in both, and words learned from sourced names fill in the vowels.",
    consonants: "consonants",
    typed: "The same consonants find a douar typed in Latin letters on {link}.",
    typedLink: "the douars page",
    accuracy: "How close it gets",
    accuracyBody: "On sourced douars the engine never saw, against how often 2 sources agree with each other.",
    accuracyRows: { exact: "Engine, letter for letter", close: "Engine, within a letter", agree: "Ministry and map agree" },
    fractions: "Fractions",
    fractionsBody: "A fraction named like one of its commune’s douars takes that douar’s Latin name. HCP lists a few under a label, which is translated.",
    fractionRows: { named: "Named after a douar", label: "A label, translated", spelt: "Spelt by the engine" },
    visitors: "From visitors",
    visitorsBody:
      "Anyone can suggest a spelling for a douar no source names. The engine checks each one overnight, and a spelling that reads as the douar’s Arabic and that visitors agree on goes live.",
    findDouar: "Find a douar",
  },
  fr: {
    title: "Comment les douars reçoivent leur nom latin",
    description:
      "D’où vient le nom latin de chaque douar : d’une source rapprochée de l’arabe du HCP et testée contre le hasard, ou d’un moteur qui l’écrit à partir de l’arabe.",
    lede: "Le HCP ne nomme ses {douars} douars qu’en arabe. Voici d’où vient chaque nom latin de ce site.",
    found: "Trouvés dans une source",
    foundBody: "{sourced} noms viennent d’une source qui les écrit, chacun rapproché de l’arabe du HCP parmi les douars de sa propre commune.",
    sources: {
      education: "Listes d’écoles du ministère de l’Éducation",
      osm: "OpenStreetMap",
      geonames: "GeoNames",
      visitors: "Visiteurs",
      spelt: "Écrits par le moteur",
    },
    chance: "Testés contre le hasard",
    chanceBody: "Chaque passe de rapprochement tourne une seconde fois, chaque commune échangée contre une autre. Ce qu’elle trouve encore relève du hasard, et une passe au-delà de la ligne est écartée.",
    chanceRows: { schools: "Listes d’écoles", places: "Cartes", near: "Cartes, près des douars déjà placés" },
    chanceLimit: "la ligne",
    engine: "Écrits par le moteur",
    engineBody:
      "Les {spelt} autres sont écrits à partir de l’arabe, et s’affichent en italique. Les 2 écritures se ramènent aux mêmes consonnes pour {keysMeet} des noms que le HCP donne dans les 2, et des mots appris des noms trouvés complètent les voyelles.",
    consonants: "consonnes",
    typed: "Les mêmes consonnes trouvent un douar tapé en lettres latines sur {link}.",
    typedLink: "la page des douars",
    accuracy: "À quel point il s’approche",
    accuracyBody: "Sur des douars nommés par une source que le moteur n’a jamais vus, face à la fréquence à laquelle 2 sources s’accordent.",
    accuracyRows: { exact: "Moteur, à la lettre près", close: "Moteur, à une lettre près", agree: "Ministère et carte d’accord" },
    fractions: "Les fractions",
    fractionsBody: "Une fraction qui porte le nom d’un douar de sa commune prend le nom latin de ce douar. Le HCP en range quelques-unes sous une étiquette, traduite.",
    fractionRows: { named: "Nommée d’après un douar", label: "Une étiquette, traduite", spelt: "Écrite par le moteur" },
    visitors: "Proposés par les visiteurs",
    visitorsBody:
      "Chacun peut proposer une graphie pour un douar qu’aucune source ne nomme. Le moteur vérifie chacune pendant la nuit, et une graphie qui se lit comme l’arabe du douar et sur laquelle des visiteurs s’accordent s’affiche.",
    findDouar: "Trouver un douar",
  },
  ar: {
    title: "كيف تحصل الدواوير على أسمائها اللاتينية",
    description:
      "من أين يأتي الاسم اللاتيني لكل دوار: من مصدر بعد مطابقته مع الاسم العربي لدى المندوبية السامية للتخطيط واختبار الصدفة، أو من محرك يكتبه انطلاقا من العربية.",
    lede: "تسمي المندوبية السامية للتخطيط {douars} دوار بالعربية فقط. وهذه مصادر الأسماء اللاتينية في هذا الموقع.",
    found: "مأخوذة من مصدر",
    foundBody: "{sourced} اسم يأتي من مصدر يكتبه، بعد مطابقة كل اسم مع الاسم العربي لدى المندوبية السامية للتخطيط ضمن دواوير جماعته.",
    sources: {
      education: "لوائح مدارس وزارة التربية الوطنية",
      osm: "OpenStreetMap",
      geonames: "GeoNames",
      visitors: "الزوار",
      spelt: "كتبها المحرك",
    },
    chance: "اختبار الصدفة",
    chanceBody: "كل عملية مطابقة تعاد بعد تبديل كل جماعة بجماعة أخرى. ما تجده حينها صدفة، والعملية التي تتجاوز الحد تستبعد.",
    chanceRows: { schools: "لوائح المدارس", places: "الخرائط", near: "الخرائط، قرب دواوير سبق تحديد موقعها" },
    chanceLimit: "الحد",
    engine: "كتبها المحرك",
    engineBody:
      "باقي الأسماء، وعددها {spelt}، مكتوبة انطلاقا من العربية وتظهر بخط مائل. الكتابتان ترجعان إلى الصوامت نفسها في {keysMeet} من الأسماء التي توردها المندوبية السامية للتخطيط بهما معا، أما الصوائت فتكملها كلمات مستخلصة من الأسماء المأخوذة من المصادر.",
    consonants: "الصوامت",
    typed: "الصوامت نفسها تجد الدوار حين يكتب اسمه بالحروف اللاتينية في {link}.",
    typedLink: "صفحة الدواوير",
    accuracy: "مدى دقة المحرك",
    accuracyBody: "على دواوير لها مصدر ولم يرها المحرك من قبل، مقارنة بنسبة اتفاق مصدرين فيما بينهما.",
    accuracyRows: { exact: "المحرك، حرفا بحرف", close: "المحرك، في حدود حرف واحد", agree: "اتفاق الوزارة والخريطة" },
    fractions: "المشيخات",
    fractionsBody: "المشيخة التي تحمل اسم أحد دواوير جماعتها تأخذ الاسم اللاتيني لذلك الدوار. وبعض المشيخات تدرجها المندوبية السامية للتخطيط تحت وصف، وهذا الوصف يترجم.",
    fractionRows: { named: "تحمل اسم دوار", label: "وصف مترجم", spelt: "كتبها المحرك" },
    visitors: "من الزوار",
    visitorsBody:
      "يمكن لأي شخص أن يقترح كتابة لدوار لا يسميه أي مصدر. يتحقق المحرك من كل اقتراح ليلا، وتنشر الكتابة التي تقرأ مثل الاسم العربي للدوار ويتفق عليها الزوار.",
    findDouar: "ابحث عن دوار",
  },
} as const;
