import { LOCS, type GeoPoint } from "./geo-data";
export { LOCS, type GeoPoint };

const ALIASES: Record<string, string> = {
  "lynwood": "lynnwood",
  "lynwood glen": "lynnwood glen",
  "lynwood manor": "lynnwood manor",
  "lynwood ridge": "lynnwood ridge",
  "pta": "pretoria",
  "pta central": "pretoria central",
  "pta north": "pretoria north",
  "pta west": "pretoria west",
  "pta east": "pretoria east",
  "jhb": "johannesburg",
  "jhb cbd": "johannesburg",
  "jozi": "johannesburg",
  "joburg": "johannesburg",
  "ct": "cape town",
  "cpt": "cape town",
  "dbn": "durban",
  "dbns": "durban",
  "pe": "port elizabeth",
  "gqeberha": "port elizabeth",
  "bloem": "bloemfontein",
  "pmb": "pietermaritzburg",
  "nelspruit": "mbombela",
  "mbombela": "nelspruit",
  "pietersburg": "polokwane",
  "potgietersrus": "mokopane",
  "nylstroom": "modimolle",
  "naboomspruit": "mookgopong",
  "warmbaths": "bela-bela",
  "messina": "musina",
  "louis trichardt": "makhado",
  "ellisras": "lephalale",
  "witbank": "emalahleni",
  "emalahleni": "witbank",
  "middelburg mp": "middelburg",
  "piet retief": "emkhondo",
  "duiwelskloof": "modjadjiskloof",
  "verwoerdburg": "centurion",
  "mafikeng": "mahikeng",
  "mafeking": "mahikeng",
  "tlokwe": "potchefstroom",
  "madibeng": "brits",
  "kwadukuza": "stanger",
  "kariega": "uitenhage",
  "komani": "queenstown",
  "qonce": "king williams town",
  "makhanda": "grahamstown",
  "mashishing": "lydenburg",
  "entokozweni": "machadodorp",
  "mangaung": "bloemfontein",
  "halfway": "halfway house",
  "khayalami estate": "khayalami",
  "silver lakes": "silverlakes",
  "moreletapark": "moreleta park",
  "elarduspark": "elardus park",
  "monumentpark": "monument park",
  "wierdapark": "wierda park",
  "glen austin ah": "glen austin",
  "midstream estate": "midstream",
  "centurion central": "centurion",
  "waterkloof glen": "waterkloof",
  "soshanguve block h": "soshanguve",
  "soshanguve block l": "soshanguve",
  "soshanguve block vv": "soshanguve",
  "soshanguve block jj": "soshanguve",
  "soshanguve south": "soshanguve",
  "ga-rankuwa zone 1": "ga-rankuwa",
  "ga-rankuwa zone 2": "ga-rankuwa",
  "ga-rankuwa zone 3": "ga-rankuwa",
  "ga-rankuwa zone 4": "ga-rankuwa",
  "ga-rankuwa zone 5": "ga-rankuwa",
  "ga-rankuwa zone 16": "ga-rankuwa",
  "mamelodi gardens": "mamelodi",
  "mamelodi east": "mamelodi",
  "mamelodi west": "mamelodi",
  "shere": "garsfontein",
  "maroelana": "lynnwood",
  "the wilds": "pretoria",
  "highlands north": "norwood",
  "sydenham jhb": "sydenham",
  "newlands jhb": "newlands",
  "panorama roodepoort": "panorama jhb",
  "orchards pta": "orchards",
  "orchards pretoria": "orchards",
  "orchards johannesburg": "orchards jhb",
  "florida lake": "florida",
  "florida junction": "florida",
  "florida west": "florida",
  "bryanston west": "bryanston",
  "bryanston east": "bryanston",
  "sandton central": "sandton",
  "sandton cbd": "sandton",
  "sandown ext": "sandown",
  "norwood jhb": "norwood",
  "kensington jhb": "kensington",
  "bedfordview ext": "bedfordview",
  "edenvale central": "edenvale",
  "kempton park central": "kempton park",
  "kempton park cbd": "kempton park",
  "boksburg central": "boksburg",
  "boksburg cbd": "boksburg",
  "benoni central": "benoni",
  "benoni cbd": "benoni",
  "germiston cbd": "germiston",
  "germiston central": "germiston",
  "springs central": "springs",
  "springs cbd": "springs",
  "krugersdorp cbd": "krugersdorp",
  "krugersdorp central": "krugersdorp",
  "randfontein cbd": "randfontein",
  "randfontein central": "randfontein",
  "alberton cbd": "alberton",
  "alberton central": "alberton",
  "rodepoort": "roodepoort",
  "fourways crossing": "fourways",
  "fourways mall": "fourways",
  "waterfall park": "waterfall",
  "waterfall corner": "waterfall",
  "diepsloot west": "diepsloot",
  "diepsloot east": "diepsloot",
  "cosmo city ext": "cosmo city",
  "tembisa central": "tembisa",
  "ivory park ext": "ivory park",
  "randburg central": "randburg",
  "centurion mall": "centurion",
  "centurion cbd": "centurion",
  "midrand central": "midrand",
  "midrand cbd": "midrand",
  "parkwood jhb": "parkwood",
};

export function haversine(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLa = ((b.lat - a.lat) * Math.PI) / 180;
  const dLo = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLo / 2) * Math.sin(dLo / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

const POSTAL_REGION: Record<string, string> = {
  "0001": "pretoria", "0002": "pretoria", "0007": "pretoria", "0008": "pretoria",
  "0010": "pretoria", "0011": "pretoria", "0020": "pretoria", "0028": "pretoria",
  "0040": "pretoria", "0041": "pretoria", "0042": "pretoria", "0043": "pretoria",
  "0044": "pretoria", "0045": "pretoria", "0046": "pretoria", "0048": "pretoria",
  "0050": "pretoria", "0051": "pretoria", "0081": "pretoria", "0082": "pretoria",
  "0083": "pretoria", "0084": "pretoria", "0086": "pretoria",
  "0100": "pretoria", "0102": "pretoria", "0110": "pretoria", "0120": "pretoria",
  "0140": "pretoria", "0152": "centurion", "0153": "centurion", "0154": "centurion",
  "0155": "centurion", "0156": "centurion", "0157": "centurion", "0158": "centurion",
  "0159": "centurion", "0160": "centurion", "0161": "centurion", "0162": "centurion",
  "0163": "centurion", "0167": "centurion", "0169": "centurion", "0170": "centurion",
  "0171": "centurion", "0172": "centurion", "0173": "centurion", "0176": "centurion",
  "0178": "centurion", "0181": "centurion", "0182": "centurion", "0183": "centurion",
  "0184": "centurion", "0185": "centurion", "0186": "centurion",
  "1685": "midrand", "1682": "midrand", "1683": "midrand", "1684": "midrand",
  "1686": "midrand",
  "1665": "olifantsfontein", "1666": "olifantsfontein",
  "1724": "krugersdorp", "1725": "krugersdorp", "1739": "muldersdrift",
  "1740": "muldersdrift", "1741": "muldersdrift", "1742": "roodepoort",
  "1709": "roodepoort", "1710": "roodepoort", "1711": "roodepoort",
  "1712": "roodepoort", "1713": "roodepoort", "1714": "roodepoort",
  "1715": "roodepoort",
  "2000": "johannesburg", "2001": "johannesburg", "2006": "johannesburg",
  "2007": "johannesburg", "2008": "johannesburg", "2009": "johannesburg",
  "2010": "johannesburg", "2013": "johannesburg", "2017": "johannesburg",
  "2090": "johannesburg", "2091": "johannesburg", "2092": "johannesburg",
  "2093": "johannesburg", "2094": "johannesburg", "2095": "johannesburg",
  "2021": "sandton", "2024": "sandton", "2031": "sandton", "2055": "sandton",
  "2057": "sandton", "2060": "sandton", "2061": "sandton", "2062": "sandton",
  "2063": "sandton", "2065": "sandton", "2066": "sandton", "2067": "sandton",
  "2068": "sandton", "2069": "sandton", "2070": "sandton", "2146": "sandton",
  "2191": "sandton", "2192": "sandton", "2193": "sandton", "2194": "sandton",
  "2196": "sandton",
  "1619": "germiston", "1620": "germiston",
  "1600": "boksburg", "1610": "boksburg",
  "1500": "benoni", "1501": "benoni", "1502": "benoni",
};

const CITY_ALIASES: Record<string, string> = {
  "pretoria": "pretoria", "tshwane": "pretoria", "pta": "pretoria",
  "centurion": "centurion", "midrand": "midrand",
  "johannesburg": "johannesburg", "jhb": "johannesburg", "joburg": "johannesburg",
  "sandton": "sandton", "randburg": "randburg",
  "muldersdrift": "muldersdrift", "krugersdorp": "krugersdorp",
  "mogale city": "krugersdorp", "roodepoort": "roodepoort",
  "germiston": "germiston", "boksburg": "boksburg", "benoni": "benoni",
  "west rand": "muldersdrift", "kempton park": "kempton park",
  "olifantsfontein": "olifantsfontein", "olifants fontein": "olifantsfontein",
  "hartbeespoort": "hartbeespoort",
  "soweto": "soweto", "lenasia": "lenasia",
};

const DISAMBIG: Record<string, Record<string, string>> = {
  "zwartkops": {
    "pretoria": "zwartkop",
    "centurion": "zwartkop",
    "tshwane": "zwartkop",
    "muldersdrift": "zwartkops muldersdrift",
    "krugersdorp": "zwartkops muldersdrift",
    "west rand": "zwartkops muldersdrift",
  },
  "zwartkop": {
    "pretoria": "zwartkop",
    "centurion": "zwartkop",
    "tshwane": "zwartkop",
    "muldersdrift": "zwartkops muldersdrift",
    "krugersdorp": "zwartkops muldersdrift",
    "west rand": "zwartkops muldersdrift",
  },
};

function resolveRegion(city: string, postal: string): string {
  if (postal && POSTAL_REGION[postal]) return POSTAL_REGION[postal];
  if (city) {
    const ck = city.toLowerCase().trim();
    if (CITY_ALIASES[ck]) return CITY_ALIASES[ck];
    return ck;
  }
  return "";
}

export function geoLookup(sub: string, city?: string, postal?: string): GeoPoint | null {
  if (!sub || !sub.trim()) {
    if (city) {
      const ck = city.toLowerCase().trim().replace(/\s+/g, " ");
      if (LOCS[ck]) return LOCS[ck];
    }
    return null;
  }
  const k = sub.toLowerCase().trim().replace(/\s+/g, " ");

  const region = resolveRegion(city || "", postal || "");

  if (region && DISAMBIG[k] && DISAMBIG[k][region]) {
    const resolved = DISAMBIG[k][region];
    if (LOCS[resolved]) return LOCS[resolved];
  }

  if (region && LOCS[k + " " + region]) return LOCS[k + " " + region];

  if (LOCS[k]) return LOCS[k];

  if (ALIASES[k] && LOCS[ALIASES[k]]) return LOCS[ALIASES[k]];

  const stripped = k
    .replace(/\b(ext|extension|ext\.)\s*\d+/gi, "")
    .replace(/\b(phase|ph)\s*\d+/gi, "")
    .replace(/\b(section|sec)\s*\d+/gi, "")
    .replace(/\b(unit|view|park|estate|gardens|heights|ridge|glen|manor|village|ah|a\.h\.|agricultural holding)\s*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (stripped && stripped !== k && LOCS[stripped]) {
    const c = LOCS[stripped];
    if (c && c.lat >= -35 && c.lat <= -22 && c.lng >= 16 && c.lng <= 33) return c;
  }
  if (stripped && ALIASES[stripped] && LOCS[ALIASES[stripped]]) {
    const c = LOCS[ALIASES[stripped]];
    if (c && c.lat >= -35 && c.lat <= -22 && c.lng >= 16 && c.lng <= 33) return c;
  }

  const keys = Object.keys(LOCS);
  for (let i = 0; i < keys.length; i++) {
    if (k.indexOf(keys[i]) >= 0 || keys[i].indexOf(k) >= 0) {
      const candidate = LOCS[keys[i]];
      if (candidate && candidate.lat >= -35 && candidate.lat <= -22 && candidate.lng >= 16 && candidate.lng <= 33) {
        return candidate;
      }
    }
  }

  if (stripped && stripped !== k) {
    for (let i = 0; i < keys.length; i++) {
      if (stripped.indexOf(keys[i]) >= 0 || keys[i].indexOf(stripped) >= 0) {
        const candidate = LOCS[keys[i]];
        if (candidate && candidate.lat >= -35 && candidate.lat <= -22 && candidate.lng >= 16 && candidate.lng <= 33) {
          return candidate;
        }
      }
    }
  }

  if (city) {
    const ck = city.toLowerCase().trim().replace(/\s+/g, " ");
    const resolvedCity = CITY_ALIASES[ck] || ck;
    if (LOCS[resolvedCity]) return LOCS[resolvedCity];
  }

  return null;
}

export type TrafficCondition = "normal" | "moderate" | "heavy";

let _trafficCondition: TrafficCondition = "normal";

export function setTrafficCondition(c: TrafficCondition) { _trafficCondition = c; }
export function getTrafficCondition(): TrafficCondition { return _trafficCondition; }

function trafficMultiplier(departMin: number | null | undefined, km: number): number {
  let mult = 1.0;

  if (departMin != null) {
    const isMorningRush = departMin >= 375 && departMin <= 525;
    const isEveningRush = departMin >= 915 && departMin <= 1065;
    const isMidRush = departMin >= 690 && departMin <= 810;

    if (isMorningRush || isEveningRush) {
      if (km > 40) mult = 0.72;
      else if (km > 15) mult = 0.65;
      else mult = 0.68;
    } else if (isMidRush) {
      if (km > 15) mult = 0.85;
      else mult = 0.82;
    }
  }

  if (_trafficCondition === "moderate") {
    mult *= 0.85;
  } else if (_trafficCondition === "heavy") {
    mult *= 0.70;
  }

  return mult;
}

export interface DriveResult {
  km: number;
  min: number;
}

export function calcDrive(from: GeoPoint | null, to: GeoPoint | null, departMin?: number | null): DriveResult {
  if (!from || !to || !from.lat || !to.lat) return { km: 0, min: 3 };
  const s = haversine(from, to);
  let f: number;
  if (s < 3) f = 1.55;
  else if (s < 8) f = 1.45;
  else if (s < 18) f = 1.38;
  else if (s < 35) f = 1.30;
  else if (s < 60) f = 1.22;
  else f = 1.18;
  const km = Math.round(s * f * 10) / 10;
  let sp: number;
  if (km < 4) sp = 25;
  else if (km < 10) sp = 35;
  else if (km < 20) sp = 42;
  else if (km < 40) sp = 55;
  else if (km < 70) sp = 65;
  else sp = 70;

  const tMult = trafficMultiplier(departMin, km);
  sp *= tMult;

  const rawMin = km / sp * 60;
  const min = Math.max(Math.round(rawMin) + 2, 3);
  return { km, min };
}

export function svcTime(type: string, pcs: number): number {
  if (type === "C") return Math.min(15, Math.max(5, 5 + Math.ceil(pcs * 1.5)));
  return Math.min(15, Math.max(3, 3 + pcs));
}

export function toM(t: string | null | undefined): number | null {
  if (!t) return null;
  const p = String(t).split(":");
  return (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0);
}

export function fmM(m: number | null): string {
  if (m == null) return "--:--";
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.round(m % 60)).padStart(2, "0");
}

export function gMap(lat: number, lng: number): string {
  return "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng + "&travelmode=driving";
}

export function ts(): string {
  return new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
