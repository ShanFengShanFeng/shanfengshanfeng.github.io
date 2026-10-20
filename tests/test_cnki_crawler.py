"""Exercise complete public CNKI synchronization without network or profile PII."""

import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import requests


SOURCE = Path(__file__).resolve().parents[1] / "cnki_crawler" / "main.py"
SPEC = importlib.util.spec_from_file_location("cnki_crawler_main", SOURCE)
crawler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(crawler)
PROFILE = f"https://au.cnki.net/author/workbench/personalHomePage/{crawler.DEFAULT_AUTHOR_ID}"


def paper(number=1, **overrides):
    # Field names and representative publication values come from the verified
    # public paper-list API; unrelated personal/authorization fields are omitted.
    result = {
        "DBCode": "CJFD",
        "FileName": f"JLXY202303{number:03d}",
        "TitleName": f"基于Python的女式衬衫版样自动化生成技术 {number}",
        "AuthorName": "刘乐;任祥放;金鹏;沈雷;王军;",
        "Source": "服装学报",
        "Year": "2023",
        "Issue": "03",
        "pageRange": "17-26+69",
        "doi": "",
        "CitedCnt": 9,
        "resource": "JOURNAL",
        "ResType": "期刊",
        "url": "https://kns.cnki.net/kcms2/article/abstract?id=public-example",
        "isShow": True,
    }
    result.update(overrides)
    return result


def envelope(data):
    return {"success": True, "code": 200, "message": "success", "data": data}


def overview(total=1, **overrides):
    data = {"authorCode": crawler.DEFAULT_AUTHOR_ID, "paperCount": total, "citedCount": 227, "indexH": 9, "indexG": 12}
    data.update(overrides)
    return envelope(data)


def page(rows, number=1, total=None):
    return envelope({
        "page": number,
        "size": crawler.PAGE_SIZE,
        "total": len(rows) if total is None else total,
        "data": rows,
    })


class Response:
    def __init__(self, payload=None, status=200, json_error=False):
        self.payload = payload
        self.status_code = status
        self.json_error = json_error

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    def json(self):
        if self.json_error:
            raise ValueError("HTML, access challenge, or empty response")
        return copy.deepcopy(self.payload)


class Session:
    def __init__(self, *responses):
        self.responses = [item if isinstance(item, Response) else Response(item) for item in responses]
        self.calls = []

    def get(self, url, params, timeout):
        self.calls.append((url, dict(params), timeout))
        if not self.responses:
            raise AssertionError("Unexpected request after the supplied response sequence")
        return self.responses.pop(0)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class FetchTests(unittest.TestCase):
    def test_fetches_every_page_beyond_twenty_records(self):
        records = [paper(index) for index in range(1, 24)]
        session = Session(overview(23), page(records[:20], total=23), page(records[20:], number=2, total=23))
        data = crawler.fetch_dataset(crawler.DEFAULT_AUTHOR_ID, session)
        self.assertEqual(23, len(data["publications"]))
        self.assertEqual(23, len({row["id"] for row in data["publications"]}))
        self.assertEqual(227, data["citedby"])
        self.assertEqual("cnki", data["source"])
        self.assertEqual(PROFILE, data["profile_url"])
        self.assertEqual(["statistics-overview", "paper-list", "paper-list"], [call[0].rsplit("/", 1)[-1] for call in session.calls])
        self.assertEqual([1, 2], [call[1]["page"] for call in session.calls[1:]])
        for _, params, _ in session.calls[1:]:
            self.assertEqual(20, params["size"])
            self.assertEqual(3, params["sort"])
            self.assertNotIn("showAll", params)
        self.assertEqual([], session.responses)

    def test_zero_and_unknown_citations_remain_distinct(self):
        records = [paper(1, CitedCnt=0), paper(2, CitedCnt=None), paper(3, CitedCnt="0"), paper(4, CitedCnt=True)]
        data = crawler.fetch_dataset(crawler.DEFAULT_AUTHOR_ID, Session(overview(4, citedCount=None, indexH=0), page(records)))
        by_id = {row["id"]: row for row in data["publications"]}
        self.assertEqual(0, by_id["CJFD:JLXY202303001"]["citations"])
        self.assertIsNone(by_id["CJFD:JLXY202303002"]["citations"])
        self.assertEqual(0, by_id["CJFD:JLXY202303003"]["citations"])
        self.assertIsNone(by_id["CJFD:JLXY202303004"]["citations"])
        self.assertIsNone(data["citedby"])
        self.assertEqual(0, data["hindex"])

    def test_only_explicitly_visible_papers_are_published(self):
        records = [paper(1), paper(2, isShow=False), paper(3, isShow=None), paper(4, isShow="true")]
        data = crawler.fetch_dataset(crawler.DEFAULT_AUTHOR_ID, Session(overview(4), page(records)))
        self.assertEqual(["CJFD:JLXY202303001"], [row["id"] for row in data["publications"]])

    def test_unknown_api_fields_are_not_republished(self):
        record = paper(extraProfileField="do not publish", arbitraryNewField={"nested": True})
        data = crawler.fetch_dataset(crawler.DEFAULT_AUTHOR_ID, Session(overview(unrelatedProfileField="omit"), page([record])))
        encoded = json.dumps(data, ensure_ascii=False)
        self.assertNotIn("extraProfileField", encoded)
        self.assertNotIn("arbitraryNewField", encoded)
        self.assertNotIn("unrelatedProfileField", encoded)
        self.assertEqual("刘乐, 任祥放, 金鹏, 沈雷, 王军", data["publications"][0]["authors"])

    def test_dissertation_preserves_filename_and_resource_description(self):
        record = paper(FileName="1021757060.nh", DBCode="CMFD", resource="DISSERTATION", ResType="硕士", Source="江南大学", doi="10.27169/d.cnki.gwqgu.2021.001026")
        result = crawler.normalized_publication(record, PROFILE)
        self.assertEqual("CMFD:1021757060.nh", result["id"])
        self.assertIn("硕士学位论文", result["venue"])
        self.assertEqual(record["doi"], result["doi"])

    def test_invalid_author_ids_are_rejected_before_network_access(self):
        for author_id in ("", "123", "000077413616?showAll=true", "../000077413616", "0000774136167", "００００７７４１３６１６"):
            with self.subTest(author_id=author_id):
                session = Session()
                with self.assertRaises(ValueError):
                    crawler.fetch_dataset(author_id, session)
                self.assertEqual([], session.calls)


class FailurePreservationTests(unittest.TestCase):
    def assert_main_preserves_previous_output(self, session):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cnki_data.json"
            previous = b'{"previous_successful_dataset":true}\n'
            output.write_bytes(previous)
            with mock.patch.object(crawler, "create_session", return_value=session), \
                    mock.patch.dict(os.environ, {"CNKI_AUTHOR_ID": crawler.DEFAULT_AUTHOR_ID}), \
                    mock.patch("sys.argv", ["cnki", "--output", str(output)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises((ValueError, requests.RequestException)):
                    crawler.main()
            self.assertEqual(previous, output.read_bytes())
            self.assertEqual([output], list(Path(directory).iterdir()))
            self.assertEqual([], session.responses, "The scenario must reach the deliberately failing response")

    def test_a_different_author_response_preserves_saved_data(self):
        self.assert_main_preserves_previous_output(Session(overview(authorCode="000000000001")))

    def test_successful_main_replaces_saved_data_with_readable_utf8(self):
        session = Session(overview(), page([paper()]))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cnki_data.json"
            output.write_text("old", encoding="utf-8")
            with mock.patch.object(crawler, "create_session", return_value=session), \
                    mock.patch.dict(os.environ, {"CNKI_AUTHOR_ID": crawler.DEFAULT_AUTHOR_ID}), \
                    mock.patch("sys.argv", ["cnki", "--output", str(output)]), \
                    contextlib.redirect_stdout(io.StringIO()):
                crawler.main()
            raw = output.read_text(encoding="utf-8")
            saved = json.loads(raw)
            self.assertIn("金鹏", raw)
            self.assertEqual(1, len(saved["publications"]))
            self.assertEqual(crawler.DEFAULT_AUTHOR_ID, saved["author_id"])
            self.assertEqual([], session.responses)
            self.assertEqual([output], list(Path(directory).iterdir()))

    def test_http_challenge_json_error_or_access_denial_preserve_saved_data(self):
        failures = [
            Response(status=418),
            Response(json_error=True),
            Response({"success": False, "code": 401, "message": "login required"}),
            Response({"success": False, "code": 200, "message": "verification required"}),
            Response({"success": True, "code": 200, "data": None}),
            Response([]),
        ]
        for failure in failures:
            with self.subTest(payload=failure.payload, status=failure.status_code):
                self.assert_main_preserves_previous_output(Session(overview(), failure))

    def test_empty_page_or_all_hidden_rows_preserve_saved_data(self):
        for payload in (page([], total=0), page([], total=12), page([paper(isShow=False)])):
            with self.subTest(payload=payload):
                self.assert_main_preserves_previous_output(Session(overview(), payload))

    def test_repeated_page_number_or_duplicate_paper_ids_preserve_saved_data(self):
        first = [paper(index) for index in range(1, 21)]
        for second in (page([paper(21)], number=1, total=21), page([paper(1)], number=2, total=21)):
            with self.subTest(second=second):
                self.assert_main_preserves_previous_output(Session(overview(21), page(first, total=21), second))

    def test_changing_total_or_more_rows_than_total_preserve_saved_data(self):
        first = [paper(index) for index in range(1, 21)]
        self.assert_main_preserves_previous_output(Session(overview(21), page(first, total=21), page([paper(21)], number=2, total=22)))
        self.assert_main_preserves_previous_output(Session(overview(), page([paper(1), paper(2)], total=1)))

    def test_truncated_pagination_preserves_saved_data(self):
        first = [paper(index) for index in range(1, 21)]
        self.assert_main_preserves_previous_output(Session(overview(25), page(first, total=25), page([paper(21)], number=2, total=25), page([], number=3, total=25)))

    def test_missing_publication_identity_or_title_preserves_saved_data(self):
        for record in (paper(FileName=""), paper(TitleName="")):
            with self.subTest(record=record):
                self.assert_main_preserves_previous_output(Session(overview(), page([record])))

    def test_failed_atomic_replace_preserves_saved_data_and_removes_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "cnki_data.json"
            output.write_text("old", encoding="utf-8")
            with mock.patch.object(crawler.os, "replace", side_effect=OSError("disk error")):
                with self.assertRaises(OSError):
                    crawler.write_dataset({"publications": []}, output)
            self.assertEqual("old", output.read_text(encoding="utf-8"))
            self.assertEqual([output], list(Path(directory).iterdir()))


class LinkTests(unittest.TestCase):
    def test_official_https_link_is_retained(self):
        url = "https://kns.cnki.net/kcms2/article/abstract?v=opaque&amp;language=CHS"
        self.assertEqual(url.replace("&amp;", "&"), crawler.cnki_url(url, PROFILE))

    def test_untrusted_or_ambiguous_links_fall_back_to_author_profile(self):
        for url in (
            None, "", "javascript:alert(1)", "//kns.cnki.net/article",
            "http://kns.cnki.net/article", "https://cnki.net.evil.example/article",
            "https://kns.cnki.net@evil.example/article",
            "https://evil.example\\@kns.cnki.net/article",
            "https://user:password@kns.cnki.net/article",
            "https://kns.cnki.net/\narticle", "https://[invalid",
        ):
            with self.subTest(url=url):
                self.assertEqual(PROFILE, crawler.cnki_url(url, PROFILE))


if __name__ == "__main__":
    unittest.main()
