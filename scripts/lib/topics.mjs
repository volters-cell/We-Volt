/* What a vote is about, read from its own title.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The Parliament tags its documents with EuroVoc, and its open data portal
 * publishes the tags as bare numbers and refuses to name them: every concept
 * endpoint answers 404, and the API publishes no vocabulary at all. So the
 * subject a reader wants — Ukraine, Migration — cannot be fetched. It can be
 * read, because it is written in the title the Parliament itself gave the
 * text: "Russia's war of aggression against Ukraine", "European Border and
 * Coast Guard Agency", "Genetically modified maize".
 *
 * This is therefore a reading of the Parliament's words, not a claim about the
 * Parliament's own classification, and the site says as much. The rules below
 * are deliberately literal: a topic appears when the title names it. Nothing
 * is inferred from what a file is probably about, because a chip that guesses
 * is worse than no chip — it tells a reader something the record cannot
 * support.
 *
 * Titles come in several languages, since the portal serves whichever it has,
 * so the common French and German forms sit beside the English ones.
 */

/* Ordered: the first pattern to match a title wins its slot. A vote gets at
   most one place and one theme, because two chips a reader can hold are worth
   more than five they skim past. */

const PLACES = [
  ['Ukraine', /\bukrain\w*/i],
  ['Russia', /\bruss\w*|\bkremlin\b|\bmoscou\b|\brusslands?\b/i],
  ['Belarus', /\bbelarus\w*|\bbiélorussie\b/i],
  ['Moldova', /\bmoldov\w*|\bmoldavie\b/i],
  ['Georgia', /\bgeorgia\b|\bgéorgie\b/i],
  ['Western Balkans', /\bwestern balkans?\b|\bbalkans occidentaux\b|\bserbi[ae]\b|\bkosovo\b|\bbosni[ae]\b|\bmont(?:e|é)n(?:e|é)gro\b|\bnorth macedonia\b|\bmac(?:e|é)doine\b|\balbani[ae]\b/i],
  ['Türkiye', /\bt(?:ü|u)rkiye\b|\bturkey\b|\bturquie\b/i],
  ['China', /\bchina\b|\bchinese\b|\bchine\b|\bhong kong\b|\bxinjiang\b|\btaiwan\b/i],
  ['Iran', /\biran\w*/i],
  ['Israel and Palestine', /\bisrael\w*|\bpalestin\w*|\bgaza\b|\bcisjordanie\b/i],
  ['Syria', /\bsyria\w*|\bsyrie\b/i],
  ['Afghanistan', /\bafghan\w*/i],
  ['Venezuela', /\bvenezuela\w*/i],
  ['Nicaragua', /\bnicaragua\w*/i],
  ['Cuba', /\bcuba\w*/i],
  ['United Kingdom', /\bunited kingdom\b|\bbrexit\b|\broyaume-uni\b|\bgibraltar\b|\bnorthern ireland\b|\bUK\b/i],
  ['United States', /\bunited states\b|\b(?<!\w)US\b(?!\w)|\bétats-unis\b/],
  ['Egypt', /\begypt\w*|\bégypte\b/i],
  ['Tunisia', /\btunisia\b|\btunisie\b/i],
  ['Libya', /\blibya\b|\blibye\b/i],
  ['Morocco', /\bmorocco\b|\bmaroc\b|\bwestern sahara\b/i],
  ['Ethiopia', /\bethiopia\w*|\béthiopie\b/i],
  ['Sudan', /\bsudan\w*|\bsoudan\b/i],
  ['Sahel', /\bsahel\b|\bmali\b|\bniger\b|\bburkina\b|\bchad\b|\btchad\b/i],
  ['Nigeria', /\bnigeria\w*/i],
  ['Myanmar', /\bmyanmar\b|\bburma\b|\bbirmanie\b/i],
  ['North Korea', /\bnorth korea\b|\bcorée du nord\b/i],
  ['Vietnam', /\bviet ?nam\b|\bviêt ?nam\b/i],
  ['India', /\bindia\b(?!n ocean)|\binde\b/i],
  ['Mexico', /\bmexic\w*|\bmexique\b/i],
  ['Brazil', /\bbrazil\w*|\bbrésil\b/i],
  ['Armenia and Azerbaijan', /\barmenia\w*|\bazerbaijan\w*|\bnagorno\b|\barménie\b/i],
  ['Kazakhstan', /\bkazakh\w*/i],
  ['Hungary', /\bhungar\w*|\bhongrie\b/i],
  ['Poland', /\bpoland\b|\bpolish\b|\bpologne\b/i],
  ['Slovakia', /\bslovakia\b|\bslovaquie\b/i],
  ['Malta', /\bmalta\b|\bmalte\b/i],
  ['Cyprus', /\bcyprus\b|\bchypre\b/i]
];

const THEMES = [
  ['Migration', /\bmigrat\w*|\basylum\b|\brefugee\w*|\basile\b|\bréfugiés?\b|\bfrontex\b|\bschengen\b|\bborder and coast guard\b|\bgarde-fronti(?:è|e)res?\b|\bfronti(?:è|e)res? ext(?:é|e)rieures?\b|\bresettlement\b/i],
  ['Climate', /\bclimate\b|\bclimat\w*|\bgreenhouse\b|\bcarbon\b|\bcarbone\b|\bemissions? trading\b|\bCO2\b|\bemission\w*\b|\bnet[- ]zero\b/i],
  ['Energy', /\benergy\b|\bénergie\b|\belectricity\b|\bélectricité\b|\bgas\b|\bgaz\b|\bnuclear\b|\bnucléaire\b|\brenewable\w*|\beuratom\b|\bhydrogen\b/i],
  ['Environment', /\benvironment\w*|\benvironnement\b|\bbiodiversit\w*|\bnature restoration\b|\bpollution\b|\bwaste\b|\bdéchets\b|\bwater\b|\bchemical\w*|\bpesticid\w*|\bsoil\b|\bforest\w*|\bdeforestation\b/i],
  ['Food and farming', /\bagricultur\w*|\bfarm\w*|\bcommon agricultural policy\b|\brural\b|\bfood\b|\balimentaire\b|\bgenetically modified\b|\bgénétiquement modifié\w*|\bmaize\b|\bmaïs\b|\bsoybean\b|\bcotton\b/i],
  ['Fisheries', /\bfisher\w*|\bfishing\b|\bpêche\b|\baquacultur\w*/i],
  ['Animal welfare', /\banimal\w*|\banimaux\b|\bbien-(?:ê|e)tre des animaux\b/i],
  ['Public health', /\bhealth\b|\bsanté\b|\bcovid\w*|\bpandemic\b|\bpandémie\b|\bmedicin\w*|\bmédicament\w*|\bvaccin\w*|\bcancer\b|\bpharmaceutical\w*/i],
  ['Gender equality', /\bgender\b|\bwomen\b|\bfemmes?\b|\bféminin\w*|\bg(?:é|e)nitales\b|\b(?:é|e)galit(?:é|e) des genres\b|\bviolence against women\b|\bequal treatment\b|\bcondition de la femme\b/i],
  ['Human rights', /\bhuman rights\b|\bdroits de l'homme\b|\bdeath penalty\b|\btorture\b|\bpeine de mort\b|\bpolitical prisoner\w*|\bfreedom of expression\b/i],
  ['Rule of law', /\brule of law\b|\bétat de droit\b|\bjudicial independence\b|\bcorruption\b|\barticle 7\b/i],
  ['Digital and tech', /\bdigital\w*|\bnumérique\b|\bartificial intelligence\b|\bintelligence artificielle\b|\bcyber\w*|\bdata protection\b|\bdonnées\b|\bonline platform\w*|\belectronic communication\w*|\btelecom\w*|\bsemiconductor\w*|\bchips act\b/i],
  ['Disinformation', /\bdisinformation\b|\bdésinformation\b|\bforeign interference\b|\bingérence\b|\bhybrid threat\w*/i],
  ['Defence and security', /\bdefence\b|\bdéfense\b|\bmilitary\b|\bmilitaire\b|\bsecurity and defence\b|\bNATO\b|\bOTAN\b|\barms\b|\bweapon\w*|\bammunition\b|\bpeace facility\b/i],
  ['Justice and policing', /\bjustice\b|\bjudicial cooperation\b|\beuropol\b|\beurojust\b|\bterroris\w*|\borganised crime\b|\bmoney laundering\b|\bblanchiment\b|\bpolice\b|\btrafficking\b/i],
  ['Trade', /\btrade\b|\bcommerce\b|\bcommercial\b|\btariff\w*|\bcustoms\b|\bdouane\w*|\bfree trade\b|\blibre-échange\b|\banti-dumping\b|\binvestment protection\b|\bpartnership agreement\b/i],
  ['Economy', /\beconomic\b|\b(?:é|e)conomique\b|\bmonetary\b|\bmon(?:é|e)taire\b|\bbanking\b|\bbancaire\b|\bcentral bank\b|\bbanque centrale\b|\beuro\b|\bfinancial stability\b|\bcapital markets\b|\binflation\b|\bsemester\b/i],
  ['Tax', /\btaxation\b|\bfiscal\w*|\btax\b|\bVAT\b|\bTVA\b|\bimpôt\w*/i],
  ['The EU budget', /\bdischarge\b|\bdécharge\b|\bbudget\w*|\bbudgétaire\b|\bmobilisation of the\b|\bmobilisation du fonds\b|\bglobalisation adjustment fund\b|\bown resources\b|\bressources propres\b|\bmultiannual financial framework\b|\bcadre financier pluriannuel\b|\bCFP\b|\b(?:é|e)tat pr(?:é|e)visionnel des recettes\b|\bplan de relance\b|\brecovery plan\b|\bbudget rectificatif\b/i],
  ['Jobs and workers', /\bemployment\b|\bemploi\b|\bworker\w*|\btravailleurs?\b|\blabour\b|\bsocial fund\b|\bworking conditions\b|\bminimum wage\b|\bplatform work\b/i],
  ['Transport', /\btransport\w*|\baviation\b|\baérien\w*|\bmaritime\b|\brail\w*|\bferroviaire\b|\broad safety\b|\bshipping\b|\bports?\b/i],
  ['Consumers', /\bconsumer\w*|\bconsommateur\w*|\bproduct safety\b/i],
  ['Single market', /\binternal market\b|\bmarché intérieur\b|\bsingle market\b|\bcompetition\b|\bconcurrence\b|\bstate aid\b|\bmachinery products\b/i],
  ['Education and culture', /\beducation\b|\béducation\b|\byouth\b|\bjeunesse\b|\berasmus\b|\bcultur\w*|\bmedia freedom\b|\bjournalis\w*|\bsport\b/i],
  ['Housing', /\bhousing\b|\blogement\b/i],
  ['Enlargement', /\baccession\b|\badhésion\b|\benlargement\b|\bélargissement\b|\bcandidate country\b/i],
  ['How Parliament works', /\bagenda\b|\bordre du jour\b|\btagesordnung\b|\brules of procedure\b|\brèglement intérieur\b|\bimmunity\b|\bimmunité\b|\bappointment of\b|\bnomination\b|\bcomposition of parliament\b|\bobjection pursuant to rule\b|\belectoral act\b|\burgen(?:cy|t) procedure\b|\bproc(?:é|e)dure d'urgence\b|\bfinal vote\b|\bvote final\b|\bsingle vote\b|\bvote unique\b/i]
];

function firstMatch(table, title) {
  for (const [label, pattern] of table) {
    if (pattern.test(title)) return label;
  }
  return null;
}

/* At most one place and one theme, place first: "Ukraine" before "Defence and
   security" is how a reader would say what the vote was about. */
/* A text about the economy and about the budget at once is about both, and
   naming only the first of them reads as a choice the title did not make. So
   the two are joined rather than ranked: "Economy and Budget". No other pair
   is treated this way, because no other pair runs together so often — a
   recovery plan, an amending budget, the monetary side of a financial
   framework are all one subject in the Parliament's own hands. */
function economyAndBudget(text) {
  // A discharge is a vote on whether a body spent its money properly, and the
  // body's own name is not the subject: "Discharge 2018: European Banking
  // Authority" is budget, not economy, however many economic words its title
  // happens to contain. Every joined label this rule produced at first was one
  // of these.
  if (/\bdischarge\b|\bd(?:é|e)charge\b/i.test(text)) return false;

  const economy = THEMES.find(function (row) { return row[0] === 'Economy'; });
  const budget = THEMES.find(function (row) { return row[0] === 'The EU budget'; });
  return economy && budget && economy[1].test(text) && budget[1].test(text);
}

export function topicsFor(title) {
  const text = String(title || '');
  if (!text.trim()) return [];
  const found = [];
  const place = firstMatch(PLACES, text);
  if (place) found.push(place);
  const theme = economyAndBudget(text) ? 'Economy and Budget' : firstMatch(THEMES, text);
  if (theme && theme !== place) found.push(theme);
  return found;
}

export const TOPIC_COUNT = PLACES.length + THEMES.length;
