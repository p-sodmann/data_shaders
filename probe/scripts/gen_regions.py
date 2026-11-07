"""Rewrites src/mars_probe/regions.json: the region table, plus a country → region map.

    uv run python scripts/gen_regions.py

The `regions` part is the table itself (edit it by hand: code → [name, lat, lon]). This script
only fills in `countries`: every ISO 3166-1 alpha-2 code mapped to the region nearest its
capital, so a country header (`CF-IPCountry`) or a GeoIP country lands on one of the table's
codes. Run it again after adding or removing regions, then copy the file to the web app:

    cp src/mars_probe/regions.json ../web/src/data/regions.json
"""

from __future__ import annotations

import json
import math
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "src" / "mars_probe" / "regions.json"

# Capital (or for a few city states, the city) of each country: ISO alpha-2 → (lat, lon).
# A capital stands in for "where the users are", which is close enough at the scale of the
# table (one region per large city, about 80 world-wide).
CAPITALS = {
    "AD": (42.5, 1.5), "AE": (24.5, 54.4), "AF": (34.5, 69.2), "AG": (17.1, -61.8),
    "AI": (18.2, -63.1), "AL": (41.3, 19.8), "AM": (40.2, 44.5), "AO": (-8.8, 13.2),
    "AQ": (-77.8, 166.7), "AR": (-34.6, -58.4), "AS": (-14.3, -170.7), "AT": (48.2, 16.4),
    "AU": (-35.3, 149.1), "AW": (12.5, -70.0), "AX": (60.1, 19.9), "AZ": (40.4, 49.9),
    "BA": (43.9, 18.4), "BB": (13.1, -59.6), "BD": (23.8, 90.4), "BE": (50.8, 4.4),
    "BF": (12.4, -1.5), "BG": (42.7, 23.3), "BH": (26.2, 50.6), "BI": (-3.4, 29.4),
    "BJ": (6.5, 2.6), "BL": (17.9, -62.8), "BM": (32.3, -64.8), "BN": (4.9, 114.9),
    "BO": (-16.5, -68.1), "BQ": (12.2, -68.3), "BR": (-15.8, -47.9), "BS": (25.1, -77.3),
    "BT": (27.5, 89.6), "BW": (-24.7, 25.9), "BY": (53.9, 27.6), "BZ": (17.3, -88.8),
    "CA": (45.4, -75.7), "CC": (-12.2, 96.8), "CD": (-4.3, 15.3), "CF": (4.4, 18.6),
    "CG": (-4.3, 15.2), "CH": (46.9, 7.4), "CI": (6.8, -5.3), "CK": (-21.2, -159.8),
    "CL": (-33.4, -70.7), "CM": (3.9, 11.5), "CN": (39.9, 116.4), "CO": (4.7, -74.1),
    "CR": (9.9, -84.1), "CU": (23.1, -82.4), "CV": (14.9, -23.5), "CW": (12.1, -68.9),
    "CX": (-10.4, 105.7), "CY": (35.2, 33.4), "CZ": (50.1, 14.4), "DE": (52.5, 13.4),
    "DJ": (11.6, 43.1), "DK": (55.7, 12.6), "DM": (15.3, -61.4), "DO": (18.5, -69.9),
    "DZ": (36.8, 3.1), "EC": (-0.2, -78.5), "EE": (59.4, 24.7), "EG": (30.0, 31.2),
    "EH": (27.2, -13.2), "ER": (15.3, 38.9), "ES": (40.4, -3.7), "ET": (9.0, 38.7),
    "FI": (60.2, 24.9), "FJ": (-18.1, 178.4), "FK": (-51.7, -57.9), "FM": (6.9, 158.2),
    "FO": (62.0, -6.8), "FR": (48.9, 2.4), "GA": (0.4, 9.5), "GB": (51.5, -0.1),
    "GD": (12.1, -61.7), "GE": (41.7, 44.8), "GF": (4.9, -52.3), "GG": (49.5, -2.5),
    "GH": (5.6, -0.2), "GI": (36.1, -5.4), "GL": (64.2, -51.7), "GM": (13.5, -16.6),
    "GN": (9.5, -13.7), "GP": (16.2, -61.5), "GQ": (3.8, 8.8), "GR": (38.0, 23.7),
    "GS": (-54.3, -36.5), "GT": (14.6, -90.5), "GU": (13.5, 144.8), "GW": (11.9, -15.6),
    "GY": (6.8, -58.2), "HK": (22.3, 114.2), "HN": (14.1, -87.2), "HR": (45.8, 16.0),
    "HT": (18.5, -72.3), "HU": (47.5, 19.0), "ID": (-6.2, 106.8), "IE": (53.3, -6.3),
    "IL": (31.8, 35.2), "IM": (54.2, -4.5), "IN": (28.6, 77.2), "IO": (-7.3, 72.4),
    "IQ": (33.3, 44.4), "IR": (35.7, 51.4), "IS": (64.1, -21.9), "IT": (41.9, 12.5),
    "JE": (49.2, -2.1), "JM": (18.0, -76.8), "JO": (31.9, 35.9), "JP": (35.7, 139.7),
    "KE": (-1.3, 36.8), "KG": (42.9, 74.6), "KH": (11.6, 104.9), "KI": (1.3, 173.0),
    "KM": (-11.7, 43.3), "KN": (17.3, -62.7), "KP": (39.0, 125.8), "KR": (37.6, 127.0),
    "KW": (29.4, 48.0), "KY": (19.3, -81.4), "KZ": (51.2, 71.4), "LA": (18.0, 102.6),
    "LB": (33.9, 35.5), "LC": (14.0, -61.0), "LI": (47.1, 9.5), "LK": (6.9, 79.9),
    "LR": (6.3, -10.8), "LS": (-29.3, 27.5), "LT": (54.7, 25.3), "LU": (49.6, 6.1),
    "LV": (56.9, 24.1), "LY": (32.9, 13.2), "MA": (34.0, -6.8), "MC": (43.7, 7.4),
    "MD": (47.0, 28.9), "ME": (42.4, 19.3), "MF": (18.1, -63.1), "MG": (-18.9, 47.5),
    "MH": (7.1, 171.4), "MK": (42.0, 21.4), "ML": (12.6, -8.0), "MM": (19.8, 96.1),
    "MN": (47.9, 106.9), "MO": (22.2, 113.5), "MP": (15.2, 145.8), "MQ": (14.6, -61.1),
    "MR": (18.1, -16.0), "MS": (16.7, -62.2), "MT": (35.9, 14.5), "MU": (-20.2, 57.5),
    "MV": (4.2, 73.5), "MW": (-14.0, 33.8), "MX": (19.4, -99.1), "MY": (3.1, 101.7),
    "MZ": (-25.9, 32.6), "NA": (-22.6, 17.1), "NC": (-22.3, 166.5), "NE": (13.5, 2.1),
    "NF": (-29.1, 168.0), "NG": (9.1, 7.5), "NI": (12.1, -86.3), "NL": (52.4, 4.9),
    "NO": (59.9, 10.8), "NP": (27.7, 85.3), "NR": (-0.5, 166.9), "NU": (-19.1, -169.9),
    "NZ": (-41.3, 174.8), "OM": (23.6, 58.4), "PA": (9.0, -79.5), "PE": (-12.0, -77.0),
    "PF": (-17.5, -149.6), "PG": (-9.4, 147.2), "PH": (14.6, 121.0), "PK": (33.7, 73.1),
    "PL": (52.2, 21.0), "PM": (46.8, -56.2), "PN": (-25.1, -130.1), "PR": (18.5, -66.1),
    "PS": (31.9, 35.2), "PT": (38.7, -9.1), "PW": (7.5, 134.6), "PY": (-25.3, -57.6),
    "QA": (25.3, 51.5), "RE": (-20.9, 55.5), "RO": (44.4, 26.1), "RS": (44.8, 20.5),
    "RU": (55.8, 37.6), "RW": (-1.9, 30.1), "SA": (24.7, 46.7), "SB": (-9.4, 160.0),
    "SC": (-4.6, 55.5), "SD": (15.6, 32.5), "SE": (59.3, 18.1), "SG": (1.3, 103.8),
    "SH": (-15.9, -5.7), "SI": (46.1, 14.5), "SJ": (78.2, 15.6), "SK": (48.1, 17.1),
    "SL": (8.5, -13.2), "SM": (43.9, 12.4), "SN": (14.7, -17.5), "SO": (2.0, 45.3),
    "SR": (5.9, -55.2), "SS": (4.9, 31.6), "ST": (0.3, 6.7), "SV": (13.7, -89.2),
    "SX": (18.0, -63.1), "SY": (33.5, 36.3), "SZ": (-26.3, 31.1), "TC": (21.5, -71.1),
    "TD": (12.1, 15.0), "TF": (-49.4, 70.2), "TG": (6.1, 1.2), "TH": (13.8, 100.5),
    "TJ": (38.6, 68.8), "TK": (-9.2, -171.8), "TL": (-8.6, 125.6), "TM": (37.9, 58.4),
    "TN": (36.8, 10.2), "TO": (-21.1, -175.2), "TR": (39.9, 32.9), "TT": (10.7, -61.5),
    "TV": (-8.5, 179.2), "TW": (25.0, 121.6), "TZ": (-6.2, 35.7), "UA": (50.5, 30.5),
    "UG": (0.3, 32.6), "UM": (19.3, 166.6), "US": (38.9, -77.0), "UY": (-34.9, -56.2),
    "UZ": (41.3, 69.3), "VA": (41.9, 12.5), "VC": (13.2, -61.2), "VE": (10.5, -66.9),
    "VG": (18.4, -64.6), "VI": (18.3, -64.9), "VN": (21.0, 105.8), "VU": (-17.7, 168.3),
    "WF": (-13.3, -176.2), "WS": (-13.8, -171.8), "XK": (42.7, 21.2), "YE": (15.4, 44.2),
    "YT": (-12.8, 45.2), "ZA": (-25.7, 28.2), "ZM": (-15.4, 28.3), "ZW": (-17.8, 31.0),
}  # fmt: skip


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


def nearest(regions: dict, lat: float, lon: float) -> str:
    return min(regions, key=lambda c: distance_km(lat, lon, regions[c][1], regions[c][2]))


def render(regions: dict, countries: dict) -> str:
    # One entry per line: the file is read by people (and diffed) as often as by code.
    def block(d):
        return ",\n".join(f"    {json.dumps(k)}: {json.dumps(v)}" for k, v in d.items())

    regions_part = f'  "regions": {{\n{block(regions)}\n  }}'
    countries_part = f'  "countries": {{\n{block(countries)}\n  }}'
    return f"{{\n{regions_part},\n{countries_part}\n}}\n"


def main() -> None:
    regions = json.loads(PATH.read_text())["regions"]
    countries = {cc: nearest(regions, *CAPITALS[cc]) for cc in sorted(CAPITALS)}
    PATH.write_text(render(regions, countries))
    print(f"{PATH}: {len(regions)} regions, {len(countries)} countries")


if __name__ == "__main__":
    main()
