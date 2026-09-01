import os
import json
from datetime import datetime, timezone
from urllib.parse import urlencode

from scholarly import scholarly


DEFAULT_AUTHOR_ID = "lJydfDEAAAAJ"


def normalized_publication(publication, author_id):
    bib = publication.get("bib", {})
    author_pub_id = publication.get("author_pub_id", "")
    citation_for_view = author_pub_id if ":" in author_pub_id else f"{author_id}:{author_pub_id}"
    scholar_url = "https://scholar.google.com/citations?" + urlencode({
        "view_op": "view_citation",
        "hl": "en",
        "user": author_id,
        "citation_for_view": citation_for_view,
    })

    authors = bib.get("author", "")
    if isinstance(authors, list):
        authors = ", ".join(authors)

    return {
        "id": author_pub_id,
        "title": bib.get("title", "Untitled publication"),
        "authors": authors,
        "venue": bib.get("citation") or bib.get("journal") or "",
        "year": str(bib.get("pub_year", "")),
        "citations": publication.get("num_citations", 0),
        "scholar_url": scholar_url,
    }


def publication_sort_key(publication):
    try:
        year = int(publication["year"])
    except (TypeError, ValueError):
        year = 0
    return (-year, publication["title"].casefold())


author_id = os.environ.get("GOOGLE_SCHOLAR_ID", DEFAULT_AUTHOR_ID).strip()
author = scholarly.search_author_id(author_id)
scholarly.fill(author, sections=["basics", "indices", "counts", "publications"])

publications = [normalized_publication(item, author_id) for item in author.get("publications", [])]
publications.sort(key=publication_sort_key)
if not publications:
    raise RuntimeError("Google Scholar returned no publications; keeping the last successful dataset.")

output = {
    "schema_version": 2,
    "updated_at": datetime.now(timezone.utc).isoformat(),
    "author_id": author_id,
    "name": author.get("name", "Peng Jin"),
    "affiliation": author.get("affiliation", ""),
    "citedby": author.get("citedby", 0),
    "citedby5y": author.get("citedby5y", 0),
    "hindex": author.get("hindex", 0),
    "hindex5y": author.get("hindex5y", 0),
    "i10index": author.get("i10index", 0),
    "i10index5y": author.get("i10index5y", 0),
    "publications": publications,
}

print(json.dumps(output, ensure_ascii=False, indent=2))
os.makedirs("results", exist_ok=True)
with open("results/gs_data.json", "w", encoding="utf-8") as outfile:
    json.dump(output, outfile, ensure_ascii=False, indent=2)

shieldio_data = {
    "schemaVersion": 1,
    "label": "citations",
    "message": str(output["citedby"]),
}
with open("results/gs_data_shieldsio.json", "w", encoding="utf-8") as outfile:
    json.dump(shieldio_data, outfile, ensure_ascii=False)
