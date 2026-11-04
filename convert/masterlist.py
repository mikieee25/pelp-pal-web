"""
convert_exports.py

Converts every PELP System Excel export in this folder into its own .json file
(same idea as masterlist.py, but for the other exports).

Usage:
    python convert_exports.py                 # reads *.xlsx here, writes to ./json_output/
    python convert_exports.py -i exports -o seed_data
    python convert_exports.py --pretty        # indented JSON for easier reading

Output format: one flat JSON array per workbook. Every record carries
"source_sheet" (the tab it came from, e.g. "Done", "Pending") so no
information is lost when tabs are merged. Company registrations are nested
by their header group (company_address, president, pcr, ...).

The product Masterlist is handled here too (same logic as masterlist.py) and is
written as the compact catalog file "masterlist.json" for the Supabase upload.
It is detected by file name: anything with "masterlist" in it (any case), e.g.
Masterlist_All_Download_000000.xlsx or masterlist.xlsx. Every other workbook is
converted generically, whatever it is called - no renaming needed.

Product-detail exports (Approved_and_Registered_..., For_Product_Approval_..., etc.)
have 90-180 columns per product type, so null values are left out of each record
to keep the files small. The duplicate "Summary" tab is skipped (it only repeats
a subset of the per-type tabs).
"""
import argparse
import datetime
import glob
import hashlib
import json
import math
import os
import re
from collections import defaultdict

import pandas as pd

DATE_FORMATS = [
    "%m/%d/%Y %I:%M %p",      # 09/14/2026 12:43 PM
    "%m/%d/%Y, %I:%M:%S %p",  # 10/21/2026, 5:34:10 AM
    "%m/%d/%Y",               # 10/20/2026
    "%b %d, %Y %I:%M %p",     # Oct 20, 2026 9:09 AM
]


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
# columns that Excel stores as text but are really integers
NUMERIC_KEYS = {"no", "product_id", "amount", "current_amount", "updated_amount"}


# key fragments whose values are numbers stored as text ("9,874", ".360", "19317.86")
NUMERIC_TOKENS = (
    "performance_value", "computed_value", "energy_consumption", "monthly_", "power_input",
    "voltage", "average_price", "inventory", "processing_days", "transaction_days",
    "eep_rating", "energy_efficiency_rating", "refrigerant_amount", "standby_power",
    "luminous_area", "total_adjusted_volume", "eef_value", "pesos_per_kwh", "operating_hours",
    "number_of_", "sample_", "csec", "blade_diameter",
)
NUMBER_RE = re.compile(r"-?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?")


def snake(name):
    s = re.sub(r"\([^)]*\)", " ", str(name))          # drop "(TIN)", "(₱)"
    s = re.sub(r"[^0-9a-zA-Z]+", "_", s).strip("_").lower()
    return s or "field"


def to_iso(v):
    """Parse the date/time formats used by PELP exports; leave anything else alone."""
    if isinstance(v, (datetime.datetime, datetime.date, pd.Timestamp)):
        return v.isoformat()
    if not isinstance(v, str):
        return v
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.datetime.strptime(v.strip(), fmt)
            return dt.date().isoformat() if fmt == "%m/%d/%Y" else dt.isoformat()
        except ValueError:
            continue
    return v


def clean(v, key=""):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item") and not isinstance(v, (str, bytes)):   # numpy scalar -> python
        v = v.item()
    if isinstance(v, str):
        v = v.strip()
        if v in ("", "-"):
            return None
        if "amount" in key and "₱" in v:                       # "₱ 3,000.00" -> 3000.0
            try:
                return float(v.replace("₱", "").replace(",", "").strip())
            except ValueError:
                return v
        if v.lower() in ("true", "false"):
            return v.lower() == "true"
    if isinstance(v, str) and (key in NUMERIC_KEYS or key.endswith("_credits")) and re.fullmatch(r"-?\d+", v):
        return int(v)
    if isinstance(v, str) and any(t in key for t in NUMERIC_TOKENS) and v and NUMBER_RE.fullmatch(v) and any(ch.isdigit() for ch in v):
        num = v.replace(",", "")
        return float(num) if "." in num else int(num)
    if "date" in key or key in ("date", "applicant_last_update", "doe_last_update") or key.endswith("_update"):
        v = to_iso(v)
    return v


def unique_keys(columns):
    """snake_case the headers and de-duplicate any collisions (name, name_2, ...)."""
    seen, out = {}, []
    for c in columns:
        k = snake(c)
        seen[k] = seen.get(k, 0) + 1
        out.append(k if seen[k] == 1 else f"{k}_{seen[k]}")
    return out


# --------------------------------------------------------------------------
# readers
# --------------------------------------------------------------------------
def read_flat_sheet(xls, sheet, omit_nulls=False):
    """Normal sheet: row 1 = headers."""
    df = pd.read_excel(xls, sheet_name=sheet, dtype=object)
    df = df[[c for c in df.columns if not str(c).startswith("Unnamed:")]]   # blank separator columns
    keys = unique_keys(df.columns)
    records = []
    for _, row in df.iterrows():
        rec = {k: clean(row[c], k) for k, c in zip(keys, df.columns)}
        if all(v is None for v in rec.values()):
            continue
        # Company IDs / registration IDs must stay strings (leading zeros, mixed formats)
        if omit_nulls:
            rec = {k: v for k, v in rec.items() if v is not None}
        for idk in ("company_id", "or_number", "product_registration_id"):
            if rec.get(idk) is not None:
                rec[idk] = str(rec[idk]).strip()
        rec["source_sheet"] = sheet.strip()
        records.append(rec)
    return records


# "Company Registration" exports have a 3-row header:
#   row 1: big section, row 2: group, row 3: column name
GROUPS = {
    "Company Address": "company_address",
    "Warehouse/Factory Address": "warehouse_address",
    "Business Registration": "business_registration",
    "Company President": "president",
    "PELP Compliance Representative": "pcr",
    "PELP Assistant Compliance Representative": "assistant_pcr",
}


def read_registration_sheet(xls, sheet):
    raw = pd.read_excel(xls, sheet_name=sheet, header=None, dtype=object)
    group_row, name_row = raw.iloc[1].ffill(), raw.iloc[2]
    top_level = ["Company ID", "Company Name", "Status", "Date Entry",
                 "Applicants Last Action Date", "DOEs Last Action Date"]

    cols = []  # (group_key or None, field_key)
    for i in range(raw.shape[1]):
        g = GROUPS.get(str(group_row.iloc[i]).strip())
        name = str(name_row.iloc[i]).strip()
        field = snake(name)
        if g:
            # strip the trailing " 2" style suffixes etc. only when a group already scopes it
            field = re.sub(r"^(company|warehouse_factory|president)_", "", field)
            if g == "assistant_pcr":
                field = re.sub(r"_2$", "", field)   # "Representative Name 2" -> representative_name
        cols.append((None if name in top_level else g, field))

    records = []
    for r in range(3, raw.shape[0]):
        row = raw.iloc[r]
        rec, groups = {}, {}
        for i, (g, field) in enumerate(cols):
            key = f"{g}.{field}" if g else field
            val = clean(row.iloc[i], field)
            if g:
                groups.setdefault(g, {})[field] = val
            else:
                rec[field] = val
        if rec.get("company_id") is None and rec.get("company_name") is None:
            continue
        rec["company_id"] = str(rec["company_id"]).strip() if rec.get("company_id") else None
        for g, d in groups.items():
            rec[g] = None if all(v is None for v in d.values()) else d
        rec["source_sheet"] = sheet.strip()
        records.append(rec)
    return records


def is_product_detail_workbook(xls):
    """Wide per-product-type exports (Approved_and_Registered_..., For_Product_Approval_..., etc.)."""
    for sheet in xls.sheet_names:
        if sheet.lower() == "summary":
            continue
        cols = {str(c).strip() for c in pd.read_excel(xls, sheet_name=sheet, nrows=0).columns}
        return {"Product Status", "Last DOE Action Date", "Product Registration ID"} <= cols
    return False


def is_registration_workbook(xls):
    first = pd.read_excel(xls, sheet_name=xls.sheet_names[0], header=None, nrows=1, dtype=object)
    return str(first.iloc[0, 0]).strip().lower() == "company registration"



# --------------------------------------------------------------------------
# Masterlist (ported from masterlist.py - output format is unchanged)
# --------------------------------------------------------------------------
INSPECTOR_FIELD_KEYS = {
    'product_category', 'product_type', 'ecp_type', 'particular_product',
    'product_registration_application_type', 'certificate_of_exemption',
    'company_name', 'company', 'original_equipment_manufacturer', 'manufacturer',
    'control_number', 'product_control_number', 'brand_name', 'brand',
    'product_name', 'model_number_code', 'model_number', 'model',
    'monthly_energy_consumption_kwh', 'monthly_energy_consumption', 'energy_consumption',
    'monthly_equivalent_ghg_emission_kg_co2', 'monthly_equivalent_ghg_emission',
    'volume_l', 'volume', 'freezing_capacity', 'ice_making_capacity', 'defrost_type',
    'coldness_star_rating', 'refrigerant', 'refrigerant_used', 'gwp',
    'global_warming_potential_gwp_of_the_refrigerant', 'voltage_v', 'frequency_hz',
    'energy_efficiency_factor_eef', 'eef', 'eef_rated_performance_value',
    'cooling_capacity_kw', 'cooling_seasonal_performance_factor_cspf',
    'power_input_w', 'power_input_watts', 'power_input', 'light_output_lm',
    'energy_efficiency_value_lm_w', 'total_energy_consumption_kw', 'luminous_area_m2',
    'energy_efficiency_value', 'standby_power_w', 'load_type', 'washing_performance_ratio',
    'heater', 'washer_motor', 'spin_motor', 'fan_category', 'blade_diameter_mm',
    'maximum_fan_flow_rate_m3_min', 'maximum_fan_flow_rate', 'with_ewbs',
}


def normalize_field_key(value):
    return ''.join(char.lower() for char in str(value) if char.isascii() and char.isalnum())


INSPECTOR_FIELD_KEYS_NORMALIZED = {normalize_field_key(key) for key in INSPECTOR_FIELD_KEYS}


def ml_clean_val(v):
    if pd.isna(v):
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, str):
        return v.strip()
    return v


def is_masterlist_workbook(path, xls=None):
    """Masterlist = any workbook with "masterlist" in its file name.
    (Layout can't be used: the product-detail exports share the Masterlist's
    'Product ID' / 'Product Registration ID' / 'Product Brand' columns.)"""
    return "masterlist" in os.path.basename(path).lower()


def convert_masterlist(path, xls, out_dir, out_name):
    print(f"Reading masterlist: {os.path.basename(path)}")
    products = []
    included_fields = defaultdict(set)
    seen_products = {}
    conflicting_rows = defaultdict(list)
    duplicate_rows = 0
    generated_at = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

    for sheet in xls.sheet_names:
        if sheet.lower() == 'summary':
            continue

        product_type = sheet.strip()
        df = pd.read_excel(xls, sheet_name=sheet)
        cols = list(df.columns)

        product_id_col = next((c for c in cols if str(c).strip().lower() == 'product id'), None)
        registration_col = next((c for c in cols if str(c).strip().lower() in ['product registration id', 'control number']), None)
        ctrl_col = registration_col or product_id_col
        brand_col = next((c for c in cols if str(c).lower() in ['product brand', 'brand']), None)
        model_col = next((c for c in cols if str(c).lower() in ['model number code', 'model number', 'model']), None)

        for _, row in df.iterrows():
            control_number = ml_clean_val(row[ctrl_col]) if ctrl_col else None
            if not control_number:
                continue

            control_number = str(control_number).strip()
            source_product_id = ml_clean_val(row[product_id_col]) if product_id_col else None
            source_identity = str(source_product_id).strip() if source_product_id is not None else control_number
            brand = ml_clean_val(row[brand_col]) if brand_col else None
            model_number = ml_clean_val(row[model_col]) if model_col else None

            dynamic_fields = {}
            for c in cols:
                val = ml_clean_val(row[c])
                if val is not None and c not in [ctrl_col, brand_col, model_col] and normalize_field_key(c) in INSPECTOR_FIELD_KEYS_NORMALIZED:
                    if isinstance(val, (datetime.date, datetime.datetime)):
                        val = val.isoformat()
                    dynamic_fields[c] = val
                    included_fields[product_type].add(str(c))

            # Product ID identifies a source row; the registration/control number
            # remains the value used by QR and catalog lookup. Exact duplicate rows
            # are ignored, conflicting rows are rejected.
            identity_key = source_identity.casefold()
            identity_payload = {
                "source_product_id": source_identity,
                "control_number": control_number,
                "product_type": product_type,
                "brand": str(brand) if brand is not None else None,
                "model_number": str(model_number) if model_number is not None else None,
                "dynamic_fields": dynamic_fields,
            }
            identity_fingerprint = json.dumps(identity_payload, sort_keys=True, ensure_ascii=False, default=str)

            if identity_key in seen_products:
                if seen_products[identity_key] == identity_fingerprint:
                    duplicate_rows += 1
                    continue
                conflicting_rows[control_number].append(identity_payload)
                continue

            seen_products[identity_key] = identity_fingerprint
            id_hash = hashlib.md5(f"product-id:{source_identity}".encode()).hexdigest()
            prod_id = f"{id_hash[:8]}-{id_hash[8:12]}-{id_hash[12:16]}-{id_hash[16:20]}-{id_hash[20:]}"

            products.append({
                "id": prod_id,
                "control_number": str(control_number),
                "product_type": product_type,
                "brand": str(brand) if brand else None,
                "model_number": str(model_number) if model_number else None,
                "dynamic_fields": dynamic_fields,
                "source_version": 1,
                "updated_at": generated_at,
            })

    if conflicting_rows:
        details = ", ".join(f"{k} ({len(rows) + 1} conflicting rows)" for k, rows in conflicting_rows.items())
        raise ValueError(f"Conflicting product data for source product ID(s): {details}. Review the Excel rows before generating the catalog.")

    categories = [sh for sh in xls.sheet_names if sh.lower() != 'summary']
    print(f"  Found {len(products)} products across {len(categories)} categories.")
    if duplicate_rows:
        print(f"  Skipped {duplicate_rows} exact duplicate Excel rows.")
    print("  Inspector-visible fields retained by ECP:")
    for category in categories:
        print(f"    {category}: {', '.join(sorted(included_fields[category])) or '(none)'}")

    out_path = os.path.join(out_dir, out_name)
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(products, f, ensure_ascii=False, separators=(',', ':'))

    size = os.path.getsize(out_path)
    print(f"  -> {out_path}  ({size / (1024 * 1024):.1f} MiB)")
    if size > 50 * 1024 * 1024:
        print("  Warning: this exceeds Supabase Free's 50 MiB per-file upload limit.")
    print("  You can upload this file to the 'catalogs' bucket in Supabase.")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def convert_file(path, out_dir, pretty, masterlist_name="masterlist.json"):
    xls = pd.ExcelFile(path)
    if is_masterlist_workbook(path, xls):
        convert_masterlist(path, xls, out_dir, masterlist_name)
        return
    if is_registration_workbook(xls):
        reader = read_registration_sheet
    else:
        reader = lambda x, sh: read_flat_sheet(x, sh, omit_nulls=is_product_detail_workbook(x))

    records, per_sheet = [], {}
    for sheet in xls.sheet_names:
        if sheet.lower() == "summary":
            continue
        rows = reader(xls, sheet)
        per_sheet[sheet] = len(rows)
        records.extend(rows)

    # No. column in some exports is just a row counter that restarts - keep it, but it's harmless
    base = re.sub(r"[^0-9A-Za-z]+", "-", os.path.splitext(os.path.basename(path))[0]).strip("-").lower()
    out_path = os.path.join(out_dir, f"{base}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(records, f, ensure_ascii=False, indent=2, default=str)
        else:
            json.dump(records, f, ensure_ascii=False, separators=(",", ":"), default=str)

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"{os.path.basename(path)} -> {out_path}  ({len(records)} records, {size_mb:.2f} MiB)")
    for s, n in per_sheet.items():
        print(f"    {s}: {n}")


def main():
    ap = argparse.ArgumentParser(description="Convert PELP Excel exports to JSON.")
    ap.add_argument("-i", "--input", default=".", help="folder containing the .xlsx files (default: .)")
    ap.add_argument("-o", "--output", default="json_output", help="output folder (default: json_output)")
    ap.add_argument("--pretty", action="store_true", help="indent the JSON output")
    args = ap.parse_args()

    files = [f for f in glob.glob(os.path.join(args.input, "*.xlsx"))
             if not os.path.basename(f).startswith("~$")]
    if not files:
        print(f"No .xlsx files found in '{args.input}'.")
        return

    os.makedirs(args.output, exist_ok=True)
    # detect masterlist workbooks up front; if there are several, give each its own
    # output name so they don't overwrite each other (a single one -> masterlist.json)
    masterlists = [f for f in files if is_masterlist_workbook(f, pd.ExcelFile(f))]
    for path in sorted(files):
        try:
            ml_name = "masterlist.json"
            if len(masterlists) > 1 and path in masterlists:
                ml_name = re.sub(r"[^0-9A-Za-z]+", "-", os.path.splitext(os.path.basename(path))[0]).strip("-").lower() + ".json"
            convert_file(path, args.output, args.pretty, ml_name)
        except Exception as exc:  # keep going if one workbook is odd
            print(f"FAILED {os.path.basename(path)}: {exc}")
    print("Done.")


if __name__ == "__main__":
    main()
