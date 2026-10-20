"""Synchronize the public CNKI author-home dataset, without login credentials.

The two endpoints and their paging fields are used by CNKI's public author page.
Only a complete, validated response is written; failures leave saved data intact.
"""

import argparse
import html
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


DEFAULT_AUTHOR_ID = "000077413616"
API_BASE = "https://au.cnki.net/experts/expert-pro/author-home/"
PAGE_SIZE = 20
MAX_PAGES = 500


def clean_text(value):
    if value is None:
        return ""
    return html.unescape(re.sub(r"<[^>]*>", "", str(value))).strip()


def count_or_none(value):
    if isinstance(value, bool) or value is None:
        return None
    text = str(value).strip()
    return int(text) if re.fullmatch(r"\d+", text) else None


def required_count(value, name):
    result = count_or_none(value)
    if result is None:
        raise ValueError(f"Invalid CNKI {name}; refusing to publish incomplete data.")
    return result


def cnki_url(value, profile_url):
    value = html.unescape(str(value or ""))
    if re.search(r"[\\\x00-\x20\x7f]", value):
        return profile_url
    try:
        parsed = urlparse(value)
        hostname = parsed.hostname or ""
    except ValueError:
        return profile_url
    if parsed.scheme == "https" and not parsed.username and not parsed.password and (hostname == "cnki.net" or hostname.endswith(".cnki.net")):
        return value
    return profile_url


def normalized_publication(record, profile_url):
    title = clean_text(record.get("TitleName"))
    filename = clean_text(record.get("FileName"))
    if not title or not filename:
        raise ValueError("CNKI publication is missing its title or stable identifier.")
    source = clean_text(record.get("Source"))
    volume = clean_text(record.get("chineseVolume"))
    issue = clean_text(record.get("Issue"))
    pages = clean_text(record.get("pageRange"))
    kind = clean_text(record.get("ResType"))
    if record.get("resource") == "DISSERTATION":
        venue = f"{source} · {kind}学位论文" if kind else f"{source} · 学位论文"
    else:
        details = volume + (f"({issue})" if issue else "")
        if pages:
            details += (": " if details else "pp. ") + pages
        venue = ", ".join(part for part in [source, details] if part)
    authors = ", ".join(part.strip() for part in re.split(r"[;；]", clean_text(record.get("AuthorName"))) if part.strip())
    return {
        "id": clean_text(record.get("DBCode")) + ":" + filename,
        "title": title,
        "authors": authors,
        "venue": venue,
        "year": clean_text(record.get("Year")),
        "citations": count_or_none(record.get("CitedCnt")),
        "doi": clean_text(record.get("doi")),
        "cnki_url": cnki_url(record.get("url") or record.get("detailurl"), profile_url),
        "publication_type": kind,
    }


def create_session():
    session = requests.Session()
    # CNKI works over its normal, verified HTTPS connection. An injected proxy
    # returned a hostname-mismatched certificate / HTTP 418 during verification.
    # Explicitly opt in if an installation actually requires an environment proxy.
    session.trust_env = os.environ.get("CNKI_USE_ENV_PROXY", "").lower() in {"1", "true", "yes"}
    session.headers.update({"Accept": "application/json", "User-Agent": "AcademicHomepageSync/1.0"})
    retries = Retry(total=2, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"])
    session.mount("https://", HTTPAdapter(max_retries=retries))
    return session


def api_get(session, endpoint, params):
    response = session.get(API_BASE + endpoint, params=params, timeout=(10, 30))
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError as error:
        raise ValueError("CNKI returned HTML or an access challenge instead of JSON.") from error
    if not isinstance(payload, dict) or payload.get("success") is not True or payload.get("code") != 200:
        raise ValueError("CNKI public request was not successful; saved data will be retained.")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("CNKI response schema changed: missing data object.")
    return data


def fetch_dataset(author_id, session, aliases=None):
    if not re.fullmatch(r"[0-9]{12}", author_id):
        raise ValueError("CNKI_AUTHOR_ID must be the 12-digit ID from the public author URL.")
    profile_url = f"https://au.cnki.net/author/workbench/personalHomePage/{author_id}"
    overview = api_get(session, "statistics-overview", {"code": author_id})
    if overview.get("authorCode") != author_id:
        raise ValueError("CNKI statistics belong to a different author.")
    records = []
    identities = set()
    expected_total = None
    for page in range(1, MAX_PAGES + 1):
        result = api_get(session, "paper-list", {"code": author_id, "page": page, "size": PAGE_SIZE, "sort": 3})
        total = required_count(result.get("total"), "publication total")
        if expected_total is None:
            expected_total = total
        if total != expected_total or required_count(result.get("page"), "page") != page:
            raise ValueError("CNKI pagination changed during synchronization; please retry.")
        items = result.get("data")
        if not isinstance(items, list) or not items:
            raise ValueError("CNKI returned an empty publication page; retaining saved data.")
        for record in items:
            if not isinstance(record, dict):
                raise ValueError("CNKI publication schema changed.")
            identity = (record.get("DBCode"), record.get("FileName"))
            if not identity[1] or identity in identities:
                raise ValueError("CNKI returned missing or repeated publication IDs.")
            identities.add(identity)
            records.append(record)
        if len(records) > expected_total:
            raise ValueError("CNKI returned more publications than its declared total.")
        if len(records) == expected_total:
            break
    else:
        raise ValueError("CNKI publication pagination exceeded its safety limit.")

    # This is the same visibility check used by the public CNKI author page.
    publications = [normalized_publication(record, profile_url) for record in records if record.get("isShow") is True]
    if not publications:
        raise ValueError("CNKI returned no visible publications; retaining saved data.")
    publications.sort(key=lambda item: (-int(item["year"] or "0") if item["year"].isdigit() else 0, item["title"]))
    return {
        "schema_version": 2,
        "source": "cnki",
        "author_id": author_id,
        "profile_url": profile_url,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "citedby": count_or_none(overview.get("citedCount")),
        "hindex": count_or_none(overview.get("indexH")),
        "gindex": count_or_none(overview.get("indexG")),
        "profile_publication_count": count_or_none(overview.get("paperCount")),
        "citation_scope": "CNKI author-profile total, including dissertations; not combined with Google Scholar.",
        "publications": publications,
        "publication_aliases": aliases or [],
    }


def write_dataset(dataset, output_path):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output_path.parent, suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(dataset, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary, output_path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "results" / "cnki_data.json")
    args = parser.parse_args()
    author_id = os.environ.get("CNKI_AUTHOR_ID", DEFAULT_AUTHOR_ID).strip()
    alias_path = Path(__file__).with_name("publication_aliases.json")
    aliases = json.loads(alias_path.read_text(encoding="utf-8")) if alias_path.exists() else []
    with create_session() as session:
        dataset = fetch_dataset(author_id, session, aliases)
    write_dataset(dataset, args.output)
    print(f"CNKI: saved {len(dataset['publications'])} publications; profile citations={dataset['citedby']}; output={args.output}")


if __name__ == "__main__":
    main()
