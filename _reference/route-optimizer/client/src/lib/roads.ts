export interface GautengRoad {
  id: string;
  name: string;
  type: "national" | "regional" | "city" | "rural";
  corridor?: string;
  suburbs?: string[];
}

export const GAUTENG_ROADS: GautengRoad[] = [
  { id: "n1_south", name: "N1 South (Ben Schoeman)", type: "national", corridor: "n1_south", suburbs: ["centurion", "lyttelton", "wierdapark", "wierda park", "eldoraigne", "clubview", "zwartkop", "pierre van ryneveld", "midrand", "halfway house"] },
  { id: "n1_north", name: "N1 North (Pienaars River)", type: "national", suburbs: ["pretoria north", "wonderboom", "hammanskraal", "temba"] },
  { id: "n4_west", name: "N4 West (Platinum Highway)", type: "national", corridor: "n4_west", suburbs: ["rosslyn", "akasia", "orchards", "the orchards", "karenpark", "annlin", "brits"] },
  { id: "n4_east", name: "N4 East (Maputo Corridor)", type: "national", suburbs: ["silverton", "mamelodi", "nellmapius", "bronkhorstspruit"] },
  { id: "n14", name: "N14 (Pretoria–Krugersdorp)", type: "national", corridor: "n14", suburbs: ["centurion", "midrand", "halfway house", "carlswald", "vorna valley", "noordwyk", "krugersdorp"] },
  { id: "n3", name: "N3 (Johannesburg–Durban)", type: "national", suburbs: ["germiston", "alberton", "heidelberg"] },
  { id: "n12_east", name: "N12 East (Witbank Highway)", type: "national", suburbs: ["benoni", "daveyton", "springs", "witbank"] },
  { id: "n12_west", name: "N12 West (Potchefstroom)", type: "national", suburbs: ["westonaria", "potchefstroom"] },
  { id: "n17", name: "N17 (Ermelo Highway)", type: "national", suburbs: ["boksburg", "springs", "ermelo"] },

  { id: "r21", name: "R21 (Albertina Sisulu Highway)", type: "regional", corridor: "r21", suburbs: ["irene", "rooihuiskraal", "erasmuskloof", "constantia park", "centurion", "kempton park", "or tambo"] },
  { id: "r101", name: "R101 (Old Johannesburg Road)", type: "regional", suburbs: ["centurion", "lyttelton", "irene", "midrand"] },
  { id: "r104", name: "R104 (Brits Road)", type: "regional", suburbs: ["rosslyn", "akasia", "ga-rankuwa"] },
  { id: "r55", name: "R55 (Old Joburg Road West)", type: "regional", suburbs: ["laudium", "erasmuskloof", "waterkloof", "centurion"] },
  { id: "r80", name: "R80 (Mabopane Highway)", type: "regional", suburbs: ["pretoria north", "soshanguve", "mabopane", "winterveldt"] },
  { id: "r573", name: "R573 (Moloto Road)", type: "regional", suburbs: ["mamelodi", "nellmapius", "bronkhorstspruit"] },
  { id: "r562", name: "R562 (Solomon Mahlangu Drive)", type: "regional", suburbs: ["centurion", "moreleta park", "silverton"] },
  { id: "r511", name: "R511 (Pelindaba Road)", type: "regional", suburbs: ["hartbeespoort", "pelindaba", "brits"] },
  { id: "r512", name: "R512 (Malibongwe Drive/Lanseria)", type: "regional", suburbs: ["randburg", "lanseria", "muldersdrift", "fourways"] },
  { id: "r28", name: "R28 (Vereeniging Road)", type: "regional", suburbs: ["alberton", "meyerton", "vereeniging"] },
  { id: "r24", name: "R24 (Albertina Sisulu/Empire)", type: "regional", suburbs: ["kempton park", "or tambo", "edenvale"] },
  { id: "r114", name: "R114 (Hans Strijdom Drive)", type: "regional", suburbs: ["lyttelton", "centurion", "irene"] },

  { id: "garsfontein_rd", name: "Garsfontein Road", type: "city", corridor: "garsfontein", suburbs: ["garsfontein", "moreleta park", "faerie glen", "woodhill", "waterkloof ridge", "menlyn"] },
  { id: "lynnwood_rd", name: "Lynnwood Road", type: "city", suburbs: ["lynnwood", "menlyn", "faerie glen", "hatfield", "brooklyn"] },
  { id: "church_st", name: "Church Street / Stanza Bopape", type: "city", corridor: "church_st", suburbs: ["pretoria central", "sunnyside", "arcadia", "hatfield", "mamelodi"] },
  { id: "pretorius_st", name: "Pretorius Street", type: "city", suburbs: ["pretoria central", "sunnyside", "hatfield"] },
  { id: "zambezi_dr", name: "Zambezi Drive", type: "city", corridor: "zambezi", suburbs: ["montana", "sinoville", "zambezi", "dorandia"] },
  { id: "simon_vermooten", name: "Simon Vermooten Road", type: "city", suburbs: ["silverton", "die wilgers", "elarduspark", "pretoria east"] },
  { id: "atterbury_rd", name: "Atterbury Road", type: "city", suburbs: ["faerie glen", "garsfontein", "menlyn", "waterkloof glen"] },
  { id: "nana_sita", name: "Nana Sita Street (formerly Skinner)", type: "city", suburbs: ["pretoria central", "pretoria west"] },
  { id: "paul_kruger", name: "Paul Kruger Street", type: "city", suburbs: ["pretoria central", "groenkloof", "pretoria south"] },
  { id: "nelson_mandela", name: "Nelson Mandela Drive", type: "city", suburbs: ["pretoria central", "sunnyside", "arcadia"] },
  { id: "steve_biko", name: "Steve Biko Road (formerly Beatrix)", type: "city", suburbs: ["arcadia", "sunnyside", "pretoria central", "hatfield"] },
  { id: "duncan_st", name: "Duncan Street", type: "city", suburbs: ["pretoria central", "hatfield", "brooklyn"] },
  { id: "lavender_rd", name: "Lavender Road", type: "city", suburbs: ["rosslyn", "orchards", "akasia"] },
  { id: "rachel_de_beer", name: "Rachel De Beer Street", type: "city", suburbs: ["karenpark", "akasia", "pretoria north"] },
  { id: "botha_ave", name: "Botha Avenue", type: "city", suburbs: ["arcadia", "sunnyside", "pretoria central"] },
  { id: "jan_shoba", name: "Jan Shoba Street (formerly Schoeman)", type: "city", suburbs: ["pretoria central", "hatfield"] },
  { id: "justice_mahomed", name: "Justice Mahomed Street", type: "city", suburbs: ["sunnyside", "pretoria central"] },
  { id: "witkoppen_rd", name: "Witkoppen Road", type: "city", suburbs: ["fourways", "lonehill", "sunninghill"] },
  { id: "william_nicol", name: "William Nicol Drive", type: "city", suburbs: ["fourways", "bryanston", "sandton"] },
  { id: "rivonia_rd", name: "Rivonia Road", type: "city", suburbs: ["sandton", "rivonia", "morningside"] },
  { id: "republic_rd", name: "Republic Road", type: "city", suburbs: ["randburg", "ferndale", "kensington b"] },
  { id: "hendrik_verwoerd", name: "Hendrik Verwoerd Drive / Jean Avenue", type: "city", suburbs: ["centurion", "eldoraigne", "wierdapark"] },
  { id: "end_st", name: "End Street / Bosman", type: "city", suburbs: ["pretoria central", "pretoria station"] },
  { id: "von_willich", name: "Von Willich Avenue", type: "city", suburbs: ["centurion", "clubview", "eldoraigne"] },
  { id: "lenchen_ave", name: "Lenchen Avenue", type: "city", suburbs: ["centurion", "clubview", "eldoraigne"] },
  { id: "john_vorster", name: "John Vorster Drive", type: "city", suburbs: ["centurion", "lyttelton", "irene"] },
  { id: "mamelodi_rd", name: "Mamelodi Road (Tsamaya)", type: "city", suburbs: ["mamelodi", "nellmapius", "silverton"] },

  { id: "moloto_rd_rural", name: "Moloto Road (Rural Section)", type: "rural", suburbs: ["bronkhorstspruit", "kwamhlanga", "moloto"] },
  { id: "brits_rd_rural", name: "Brits Road (R104 Rural)", type: "rural", suburbs: ["brits", "hartbeespoort"] },
  { id: "delmas_rd", name: "Delmas Road (R50)", type: "rural", suburbs: ["springs", "delmas"] },
  { id: "cullinan_rd", name: "Cullinan Road (R515)", type: "rural", suburbs: ["cullinan", "rayton"] },
  { id: "bronkhorstspruit_rd", name: "Bronkhorstspruit Road (R513)", type: "rural", suburbs: ["bronkhorstspruit", "ekangala"] },
  { id: "hartebeespoort_dam", name: "Hartebeespoort Dam Road (R514)", type: "rural", suburbs: ["hartbeespoort", "meerhof", "ifafi"] },
  { id: "old_warmbaths", name: "Old Warmbaths Road (R101 North)", type: "rural", suburbs: ["hammanskraal", "temba", "bela-bela"] },
  { id: "derdepoort_rd", name: "Derdepoort Road", type: "rural", suburbs: ["derdepoort", "mamelodi east"] },
  { id: "soutpan_rd", name: "Soutpan Road", type: "rural", suburbs: ["soshanguve", "ga-rankuwa", "hammanskraal"] },
];

export function searchRoads(query: string): GautengRoad[] {
  if (!query || query.trim().length < 2) return GAUTENG_ROADS;
  const q = query.toLowerCase().trim();
  return GAUTENG_ROADS.filter(r =>
    r.name.toLowerCase().includes(q) ||
    r.id.toLowerCase().includes(q) ||
    r.type.includes(q) ||
    (r.suburbs && r.suburbs.some(s => s.includes(q)))
  );
}

export function getRoadById(id: string): GautengRoad | undefined {
  return GAUTENG_ROADS.find(r => r.id === id);
}

export function getRoadsBySuburb(suburb: string): GautengRoad[] {
  const s = suburb.toLowerCase().trim();
  return GAUTENG_ROADS.filter(r => r.suburbs && r.suburbs.some(sub => sub.includes(s)));
}
