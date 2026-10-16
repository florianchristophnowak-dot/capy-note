// ==================== Mitgelieferte Bewertungsraster (optional) ====================
// Kurzfassungen niveaubezogener Deskriptoren für moderne Fremdsprachen.
// Die Texte sind bewusst kompakt gehalten (Anzeige als Tooltip/Label) und können
// an schulinterne bzw. landesspezifische Vorgaben angepasst werden.
// Punkte = Bewertungseinheiten (BE) je Kriterium; Aufgaben-BE = Summe der Kriterien.

const L = (points, label, description) => ({ points, label, description });

// ---------- Sekundarstufe I: Kriterium „Sprache" ----------

const SPRACHE_A1 = {
  id: 'sprache', name: 'Sprache',
  levels: [
    L(7, 'nahezu fehlerfrei', 'Nur wenige, leichte Verstöße; einfaches Spektrum sprachlicher Mittel und elementare textstrukturierende Mittel sicher verwendet.'),
    L(6, 'meist sicher', 'Einige leichte Verstöße; meist sichere Verwendung der lernstufengemäßen einfachen Mittel.'),
    L(5, 'überwiegend sicher', 'Überwiegend leichte Verstöße, Verständlichkeit nicht wesentlich beeinträchtigt; im Allgemeinen sichere Verwendung.'),
    L(4, 'noch verständlich', 'Auch einzelne gravierende Verstöße, Verständlichkeit noch gewährleistet; nur teilweise sichere Verwendung.'),
    L(3, 'stellenweise beeinträchtigt', 'Mehrere, auch gravierende Verstöße; eingeschränkte, sehr einfache Mittel; Textstrukturierung nur vereinzelt.'),
    L(2, 'deutlich beeinträchtigt', 'Viele, auch gravierende Verstöße; stark eingeschränkte Mittel; kaum Textstrukturierung.'),
    L(1, 'erheblich beeinträchtigt', 'Sehr viele Verstöße; unzulängliche, der Lernstufe nicht mehr entsprechende Mittel.'),
    L(0, 'unverständlich', 'Äußerst gravierende Mängel in allen sprachlichen Bereichen; unverständlicher Text.'),
  ],
};

const SPRACHE_A2 = {
  id: 'sprache', name: 'Sprache',
  levels: [
    L(6, 'nahezu fehlerfrei', 'Nur sehr wenige, leichte Verstöße; sichere, abwechslungsreiche Verwendung elementarer Mittel; einfache Textstrukturierung durchgehend sicher.'),
    L(5, 'meist sicher', 'Nur wenige, leichte Verstöße; meist sichere und treffende Verwendung; Textstrukturierung meist sicher.'),
    L(4, 'insgesamt sicher', 'Einige leichte, nur wenige gravierende Verstöße; Verständlichkeit nicht wesentlich beeinträchtigt; im Allgemeinen sichere Verwendung.'),
    L(3, 'noch verständlich', 'Mehrere, auch gravierende Verstöße; Verständlichkeit noch gewährleistet; nicht immer sichere Verwendung eines begrenzten Repertoires.'),
    L(2, 'deutlich beeinträchtigt', 'Viele, auch gravierende Verstöße; deutlich eingeschränktes Repertoire; kaum Textstrukturierung.'),
    L(1, 'erheblich beeinträchtigt', 'Sehr viele Verstöße; stark eingeschränktes Repertoire; keine Textstrukturierung.'),
    L(0, 'unverständlich', 'Äußerst gravierende Mängel in allen sprachlichen Bereichen; unverständlicher Text.'),
  ],
};

const SPRACHE_B1 = {
  id: 'sprache', name: 'Sprache',
  levels: [
    L(6, 'nahezu fehlerfrei', 'Nur vereinzelte, leichte Verstöße; breites Repertoire (Grammatik, Wortschatz, Syntax, Idiomatik, Textstrukturierung); im Ausdruck sehr treffend und abwechslungsreich.'),
    L(5, 'meist fehlerfrei', 'Leichte Verstöße; gefestigtes Repertoire; meist abwechslungsreiche, treffende Gestaltung.'),
    L(4, 'kaum beeinträchtigt', 'Mehrere, zumeist leichte Verstöße; Verständlichkeit kaum beeinträchtigt; angemessenes Repertoire.'),
    L(3, 'noch gewährleistet', 'Auch gravierende Verstöße; Verständlichkeit insgesamt noch gewährleistet; eingeschränktes Repertoire.'),
    L(2, 'deutlich beeinträchtigt', 'Viele, auch gravierende Verstöße; Verständlichkeit stellenweise deutlich beeinträchtigt; deutlich eingeschränktes Repertoire.'),
    L(1, 'stark eingeschränkt', 'Sehr viele, häufig gravierende Verstöße; Verständlichkeit insgesamt beeinträchtigt; stark eingeschränktes Ausdrucksvermögen.'),
    L(0, 'unverständlich', 'Äußerst gravierende Mängel in allen Bereichen; unverständlicher Text.'),
  ],
};

// ---------- Sekundarstufe I: Kriterium „Inhalt und Textstruktur" ----------

const INHALT_TP_A1 = {
  id: 'inhalt', name: 'Inhalt und Textstruktur',
  levels: [
    L(4, 'voll erfüllt', 'Aufgabenstellung voll und in allen wesentlichen Aspekten korrekt umgesetzt; zusammenhängender Text, klare Darstellung; Textsorte durchgängig berücksichtigt.'),
    L(3, 'weitgehend erfüllt', 'In weiten Teilen erfüllt und gelungen umgesetzt; überwiegend zusammenhängend und klar; Textsorte meist umgesetzt.'),
    L(2, 'noch erfüllt', 'Insgesamt noch erfüllt; nicht immer zusammenhängend, aber nachvollziehbar; Textsorte nur zum Teil beachtet.'),
    L(1, 'kaum erfüllt', 'Kaum mehr erfüllt; wenig zusammenhängend, teils unverständlich; Textsortenbezug kaum erkennbar.'),
    L(0, 'nicht erfüllt', 'Nicht erfüllt; zusammenhangloser bzw. unverständlicher Text; Textsorte nicht beachtet.'),
  ],
};

const INHALT_TP_A2 = {
  id: 'inhalt', name: 'Inhalt und Textstruktur',
  levels: [
    L(4, 'voll erfüllt', 'Vollständig erfüllt, alle wesentlichen Aspekte überzeugend (ggf. ideenreich) umgesetzt; durchgängig strukturierter, kohärenter Text; Textsorte umgesetzt.'),
    L(3, 'weitgehend erfüllt', 'In weiten Teilen erfüllt; überwiegend strukturiert und kohärent; Textsorte meist umgesetzt; eigene Meinung ggf. überzeugend in einfacher Form.'),
    L(2, 'noch erfüllt', 'Insgesamt noch erfüllt; nur teilweise strukturiert/kohärent; Textsorte nur zum Teil beachtet.'),
    L(1, 'kaum erfüllt', 'Kaum mehr erfüllt, nur ansatzweise umgesetzt; wenig strukturiert, inkohärent; Textsorte kaum beachtet.'),
    L(0, 'nicht erfüllt', 'Nicht erfüllt; Themaverfehlung; unstrukturierter, unverständlicher Text.'),
  ],
};

const INHALT_TP_B1 = {
  id: 'inhalt', name: 'Inhalt und Textstruktur',
  levels: [
    L(4, 'voll erfüllt', 'Vollständig erfüllt, alle wesentlichen Aspekte überzeugend (ggf. ideenreich) umgesetzt; Kommunikationssituation (Adressat, Textsorte) durchgehend überzeugend; klare, folgerichtige Darstellung.'),
    L(3, 'weitgehend erfüllt', 'Im Großen und Ganzen erfüllt, zentrale Aspekte sachgerecht umgesetzt; Kommunikationssituation meist überzeugend; meist strukturierte, folgerichtige Darstellung.'),
    L(2, 'noch erfüllt', 'Insgesamt noch erfüllt, nur wenige Aspekte umgesetzt; Kommunikationssituation wenig überzeugend; erkennbar strukturiert, aber nicht immer folgerichtig.'),
    L(1, 'kaum erfüllt', 'Kaum mehr erfüllt, nur ansatzweise umgesetzt; Kommunikationssituation kaum beachtet; unzureichend strukturiert bzw. unklar.'),
    L(0, 'nicht erfüllt', 'Nicht erfüllt; Themaverfehlung; Kommunikationssituation/Textsorte nicht beachtet; unverständliche Darstellung.'),
  ],
};

const INHALT_TA_B1 = {
  id: 'inhalt', name: 'Inhalt und Textstruktur',
  levels: [
    L(4, 'voll erfüllt', 'Aufgabenstellung vollständig erfüllt; Textaussage voll erfasst, Text- und Sachbezug durchgehend; klar strukturierte, kohärente, überzeugende Darstellung.'),
    L(3, 'wesentlich erfüllt', 'In den wesentlichen Aspekten erfüllt (kleinere Lücken unerheblich); Textaussage weitgehend erfasst; weitgehend strukturiert und kohärent.'),
    L(2, 'noch erfüllt', 'Im Allgemeinen noch erfüllt, einzelne Aspekte fehlen; Textaussage insgesamt noch erfasst; nicht immer folgerichtig.'),
    L(1, 'kaum erfüllt', 'Kaum mehr erfüllt, auch wesentliche Aspekte fehlen; Textaussage in weiten Teilen nicht erfasst; nur ansatzweise strukturiert bzw. unklar.'),
    L(0, 'nicht erfüllt', 'Nicht erfüllt; Textaussage nicht erfasst bzw. missverstanden; unstrukturierte, nicht nachvollziehbare Darstellung.'),
  ],
};

const INHALT_SM_A1 = {
  id: 'inhalt', name: 'Inhalt und Textstruktur',
  levels: [
    L(3, 'voll erfüllt', 'Vollständig erfüllt; zusammenhängende, korrekte Wiedergabe aller wesentlichen Informationen; Adressat/Textsorte lernstandsgemäß berücksichtigt; sehr einfache Umschreibungsstrategien gelungen.'),
    L(2, 'wesentlich erfüllt', 'Im Wesentlichen erfüllt; meiste relevante Informationen, nicht immer zusammenhängend/korrekt; Adressat/Textsorte im Großen und Ganzen berücksichtigt.'),
    L(1, 'kaum erfüllt', 'Kaum mehr erfüllt; unvollständige oder fehlerhafte Wiedergabe; Adressaten-/Textsortenbezug kaum erkennbar; teils Wort-für-Wort-Übersetzungen.'),
    L(0, 'nicht erfüllt', 'Nicht erfüllt; gravierende inhaltliche Fehler und Lücken; fehlender Textzusammenhang; keine Umschreibungsstrategien.'),
  ],
};

const INHALT_SM_A2 = {
  id: 'inhalt', name: 'Inhalt und Textstruktur',
  levels: [
    L(4, 'voll erfüllt', 'Vollständig erfüllt; strukturierte, korrekte Wiedergabe aller notwendigen Informationen; Textsorte und Adressatenbezug durchgehend berücksichtigt; einfache Umschreibungsstrategien geschickt.'),
    L(3, 'weitgehend erfüllt', 'In weiten Teilen erfüllt; meist strukturierte, korrekte Wiedergabe der wesentlichen Informationen; Adressat/Textsorte weitgehend berücksichtigt.'),
    L(2, 'noch erfüllt', 'Insgesamt noch erfüllt; nur teilweise strukturierte bzw. nicht immer korrekte/vollständige Wiedergabe; Adressat/Textsorte nur zum Teil beachtet.'),
    L(1, 'kaum erfüllt', 'Kaum mehr erfüllt; unvollständige, wenig strukturierte oder fehlerhafte Wiedergabe; Umschreibungsstrategien kaum zielführend.'),
    L(0, 'nicht erfüllt', 'Nicht erfüllt; gravierende Fehler und Lücken; Kommunikationssituation und Textsorte nicht beachtet.'),
  ],
};

const INHALT_SM_B1 = {
  id: 'inhalt', name: 'Inhalt und Textstruktur',
  levels: [
    L(4, 'voll erfüllt', 'Vollständig erfüllt; strukturierte, korrekte Wiedergabe aller notwendigen Informationen, ggf. mit kulturspezifischen Erläuterungen; Kommunikationssituation durchgehend überzeugend; Umschreibungsstrategien geschickt.'),
    L(3, 'weitgehend erfüllt', 'Im Großen und Ganzen erfüllt; wesentliche Informationen meist strukturiert und korrekt; Kommunikationssituation meist überzeugend.'),
    L(2, 'noch erfüllt', 'Insgesamt noch erfüllt; nur teilweise strukturierte, nicht immer korrekte/vollständige Wiedergabe; Kommunikationssituation nur zum Teil umgesetzt.'),
    L(1, 'kaum erfüllt', 'Kaum mehr erfüllt; weitgehend unvollständige oder fehlerhafte Wiedergabe; Kommunikationssituation kaum beachtet.'),
    L(0, 'nicht erfüllt', 'Nicht erfüllt; gravierende Fehler und Lücken; fehlende Strukturierung; kein Rückgriff auf Umschreibungsstrategien.'),
  ],
};

// ---------- Oberstufe: kriterienbasierte Raster (drei gleichwertige Kategorien) ----------
// Punktzuordnung 5–0 je Kategorie ist ein Operationalisierungsvorschlag
// (3 × 5 BE = 15 BE) und kann in der Aufgabe frei angepasst werden.

const OS_LEXIK = {
  id: 'lexik', name: 'Lexik (Bandbreite und Korrektheit)',
  levels: [
    L(5, 'sehr gut', 'In hohem Maße präzise und variable Wortwahl mit zielsprachentypischen Wendungen; durchgängig korrekt und verständlich.'),
    L(4, 'gut', 'Weitgehend präzise und variable Wortwahl; weitgehend korrekt, Verständlichkeit nicht beeinträchtigt.'),
    L(3, 'befriedigend', 'Im Wesentlichen präzise, variabel und korrekt; Verständlichkeit geringfügig eingeschränkt.'),
    L(2, 'ausreichend', 'Eingeschränkte, noch angemessene Wortwahl; teilweise unkorrekt, Verständlichkeit stellenweise beeinträchtigt.'),
    L(1, 'mangelhaft', 'Deutlich eingeschränkte Wortwahl; häufig unkorrekt, Verständlichkeit stark beeinträchtigt.'),
    L(0, 'ungenügend', 'Keine angemessene Wortwahl; Verständlichkeit nicht mehr gegeben.'),
  ],
};

const OS_GRAMMATIK = {
  id: 'grammatik', name: 'Grammatik (Bandbreite und Korrektheit)',
  levels: [
    L(5, 'sehr gut', 'In hohem Maße variabler Satzbau, durchgängig funktionale Strukturen; durchgängig korrekt und verständlich.'),
    L(4, 'gut', 'Weitgehend variabler Satzbau und funktionale Strukturen; weitgehend korrekt.'),
    L(3, 'befriedigend', 'Im Wesentlichen variabel, funktional und korrekt; Verständlichkeit geringfügig eingeschränkt.'),
    L(2, 'ausreichend', 'Wenig variabler Satzbau, noch angemessene Strukturen; teilweise unkorrekt, stellenweise beeinträchtigt.'),
    L(1, 'mangelhaft', 'Satzbau und Strukturen kaum angemessen; häufig unkorrekt, stark beeinträchtigt.'),
    L(0, 'ungenügend', 'Satzbau und Strukturen unzulänglich; Verständlichkeit nicht mehr gegeben.'),
  ],
};

const OS_TEXTGESTALTUNG = {
  id: 'textgestaltung', name: 'Textgestaltung (Aufbau und Angemessenheit)',
  levels: [
    L(5, 'sehr gut', 'In hohem Maße zielgerichteter Text mit durchgängig funktionaler Kohäsion; Textsortenmerkmale, Situations-/Adressatenbezug und Eigenständigkeit in hohem Maße umgesetzt.'),
    L(4, 'gut', 'Weitgehend zielgerichtet mit funktionaler Kohäsion; Textsortenmerkmale und Adressatenbezug weitgehend umgesetzt.'),
    L(3, 'befriedigend', 'Im Wesentlichen zielgerichtet, Kohäsionsmittel überwiegend funktional; Merkmale im Wesentlichen umgesetzt.'),
    L(2, 'ausreichend', 'Ansatzweise zielgerichtet, eingeschränkt funktionale Kohäsion; Merkmale nur ansatzweise umgesetzt.'),
    L(1, 'mangelhaft', 'Kaum zielgerichtet, kaum Kohäsionsmittel; Merkmale und Adressatenbezug kaum umgesetzt.'),
    L(0, 'ungenügend', 'Kein zielgerichteter Text, keine Kohäsionsmittel; Merkmale und Adressatenbezug fehlen.'),
  ],
};

const osInhaltLevels = (umgangLabel, umgangTexte) => ([
  {
    id: 'erfuellung', name: 'Aufgabenerfüllung gemäß Operator',
    levels: [
      L(5, 'sehr gut', 'Umfassend und korrekt.'),
      L(4, 'gut', 'Relevante Aspekte weitgehend berücksichtigt, weitgehend korrekt.'),
      L(3, 'befriedigend', 'Mehrere relevante Aspekte berücksichtigt, im Wesentlichen korrekt.'),
      L(2, 'ausreichend', 'Wenige relevante Aspekte, ansatzweise korrekt.'),
      L(1, 'mangelhaft', 'Kaum relevante Aspekte, kaum angemessen.'),
      L(0, 'ungenügend', 'Unzureichende Aspektauswahl, Aufgabenbezug fehlt.'),
    ],
  },
  {
    id: 'umgang', name: umgangLabel,
    levels: [
      L(5, 'sehr gut', umgangTexte[0]),
      L(4, 'gut', umgangTexte[1]),
      L(3, 'befriedigend', umgangTexte[2]),
      L(2, 'ausreichend', umgangTexte[3]),
      L(1, 'mangelhaft', umgangTexte[4]),
      L(0, 'ungenügend', umgangTexte[5]),
    ],
  },
  {
    id: 'aufbau', name: 'Inhaltlicher Aufbau (Struktur, Stringenz, Kohärenz)',
    levels: [
      L(5, 'sehr gut', 'Klar strukturiert, redundanzfrei, in hohem Maße schlüssig, durchgängig kohärent.'),
      L(4, 'gut', 'Strukturiert, weitgehend redundanzfrei, schlüssig und kohärent.'),
      L(3, 'befriedigend', 'Im Wesentlichen strukturiert, schlüssig und kohärent.'),
      L(2, 'ausreichend', 'Ansatzweise strukturiert, wiederholt redundant, noch kohärent.'),
      L(1, 'mangelhaft', 'Kaum strukturiert, häufig redundant, kaum nachvollziehbar.'),
      L(0, 'ungenügend', 'Unstrukturiert, redundant, nicht nachvollziehbar, inkohärent.'),
    ],
  },
]);

// ---------- Vorlagenliste ----------

export const RUBRIC_TEMPLATES = [
  { id: 'tp_a1', group: 'Sekundarstufe I', name: 'Textproduktion (Niveau A1)', criteria: [INHALT_TP_A1, SPRACHE_A1] },
  { id: 'tp_a2', group: 'Sekundarstufe I', name: 'Textproduktion (Niveau A2)', criteria: [INHALT_TP_A2, SPRACHE_A2] },
  { id: 'tp_b1', group: 'Sekundarstufe I', name: 'Textproduktion (Niveau B1)', criteria: [INHALT_TP_B1, SPRACHE_B1] },
  { id: 'ta_b1', group: 'Sekundarstufe I', name: 'Textaufgabe (Niveau B1)', criteria: [INHALT_TA_B1, SPRACHE_B1] },
  { id: 'sm_a1', group: 'Sekundarstufe I', name: 'Sprachmittlung (Niveau A1)', criteria: [INHALT_SM_A1, SPRACHE_A1] },
  { id: 'sm_a2', group: 'Sekundarstufe I', name: 'Sprachmittlung (Niveau A2)', criteria: [INHALT_SM_A2, SPRACHE_A2] },
  { id: 'sm_b1', group: 'Sekundarstufe I', name: 'Sprachmittlung (Niveau B1)', criteria: [INHALT_SM_B1, SPRACHE_B1] },
  {
    id: 'os_sprache', group: 'Oberstufe', name: 'Sprachliche Leistung (Oberstufe)',
    criteria: [OS_LEXIK, OS_GRAMMATIK, OS_TEXTGESTALTUNG],
    note: 'Die drei Kategorien sind gleichwertig zu berücksichtigen; Bandbreite ist gegenüber Korrektheit ausschlaggebend; Orthografie wird unter Lexik/Grammatik mitberücksichtigt.',
  },
  {
    id: 'os_inhalt_schreiben', group: 'Oberstufe', name: 'Inhaltliche Leistung – Schreiben (Oberstufe)',
    criteria: osInhaltLevels('Umgang mit Text/Thema', [
      'Durchgängig fokussiert, ggf. in hohem Maße abstrahierend; Bezüge/Belege durchgängig präzise und treffend.',
      'Weitgehend fokussiert und abstrahierend; Bezüge/Belege weitgehend treffend.',
      'Im Wesentlichen fokussiert; Bezüge/Belege im Wesentlichen treffend.',
      'Ansatzweise fokussiert; Bezüge/Belege teilweise unpassend.',
      'Kaum fokussiert; Bezüge/Belege selten bzw. zumeist unpassend.',
      'Nicht fokussiert; Bezüge/Belege falsch oder fehlend.',
    ]),
  },
  {
    id: 'os_inhalt_sm', group: 'Oberstufe', name: 'Inhaltliche Leistung – Sprachmittlung (Oberstufe)',
    criteria: osInhaltLevels('Umgang mit dem Text', [
      'Durchgängig fokussiert, ggf. abstrahierend; kulturspezifische Erläuterungen relevant; Situations-/Adressatenbezug durchgängig treffend.',
      'Weitgehend fokussiert; Situations-/Adressatenbezug weitgehend treffend.',
      'Im Wesentlichen fokussiert; Situations-/Adressatenbezug im Wesentlichen treffend.',
      'Ansatzweise fokussiert; Situations-/Adressatenbezug ansatzweise vorhanden.',
      'Kaum fokussiert; Situations-/Adressatenbezug fehlerhaft bzw. kaum vorhanden.',
      'Nicht fokussiert; Situations-/Adressatenbezug falsch oder fehlend.',
    ]),
  },
];

export const rubricMax = (rubric) =>
  (rubric?.criteria || []).reduce((s, c) => s + Math.max(...c.levels.map(l => l.points)), 0);

export const cloneRubric = (tpl) => ({
  name: tpl.name,
  note: tpl.note,
  criteria: tpl.criteria.map(c => ({ id: c.id, name: c.name, levels: c.levels.map(l => ({ ...l })) })),
});
