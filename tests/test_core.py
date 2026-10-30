import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from orcid_biosketch import build_biosketch, render_markdown, to_jsonld


def fixture():
    return json.loads((Path(__file__).parent / "fixture.json").read_text(encoding="utf-8"))


def test_builds_normalized_biosketch():
    bio = build_biosketch(fixture(), {"person": {"headline": "Researcher"}})
    assert bio["person"]["name"] == "Damien Huzard"
    assert bio["person"]["headline"] == "Researcher"
    assert bio["works"][0]["identifiers"]["doi"] == "10.1/test"
    assert bio["provenance"]["override_applied"] is True


def test_work_groups_keep_all_assertions_and_preferred_contributors():
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {"works": {"group": [{"work-summary": [
            {
                "display-index": "0",
                "put-code": 1,
                "title": {"title": {"value": "Publisher version"}},
                "source": {
                    "source-client-id": {"path": "APP-PUBLISHER"},
                    "source-name": {"value": "Publisher"},
                },
            },
            {
                "display-index": "1",
                "put-code": 2,
                "title": {"title": {"value": "Preferred version"}},
                "source": {
                    "source-orcid": {"path": "0000-0003-4820-7951"},
                    "source-name": {"value": "Researcher"},
                },
                "contributors": {"contributor": [{
                    "credit-name": {"value": "Ada Example"},
                    "contributor-orcid": {"path": "0000-0002-1825-0097"},
                    "contributor-attributes": {
                        "contributor-role": "author",
                        "contributor-sequence": "first",
                    },
                }]},
            },
        ]}]}},
    }
    work = build_biosketch(record)["works"][0]
    assert work["title"] == "Preferred version"
    assert work["authors"] == [{
        "name": "Ada Example",
        "orcid": "0000-0002-1825-0097",
        "role": "author",
        "sequence": "first",
    }]
    assert {source["id"] for source in work["assertion_sources"]} == {
        "APP-PUBLISHER", "0000-0003-4820-7951",
    }


def test_renders_machine_and_human_formats():
    bio = build_biosketch(fixture())
    assert to_jsonld(bio)["@type"] == "Person"
    assert "https://doi.org/10.1/test" in render_markdown(bio)


def test_output_matches_public_schema():
    bio = build_biosketch(fixture(), {"selection": {"max_works": 5}})
    schema = json.loads(
        (Path(__file__).parents[1] / "schema" / "biosketch.schema.json").read_text(encoding="utf-8")
    )
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(bio)


def test_public_schema_rejects_structurally_invalid_entries():
    schema = json.loads(
        (Path(__file__).parents[1] / "schema" / "biosketch.schema.json").read_text(encoding="utf-8")
    )
    bio = build_biosketch(fixture())
    bio["works"] = [None]
    bio["employment"] = [42]
    bio["provenance"]["generated_at"] = False
    assert len(list(Draft202012Validator(schema).iter_errors(bio))) >= 3


def test_parses_funding_with_amount_and_grant_number():
    funding = build_biosketch(fixture())["fundings"]
    assert [x["title"] for x in funding] == [
        "Stress resilience across the lifespan",
        "Doctoral fellowship",
    ]
    grant = funding[0]
    assert grant["organization"] == "Agence Nationale de la Recherche"
    assert grant["type"] == "grant"
    assert (grant["amount"], grant["currency"]) == ("250000", "EUR")
    assert grant["grant_number"] == "ANR-20-CE37-0001"
    assert grant["identifiers"]["grant_url"] == "https://anr.fr/Project-ANR-20-CE37-0001"
    assert grant["start_date"] == "2020-01-01"
    assert grant["end_date"] == "2023-12-31"
    assert grant["source"]["name"] == "Damien Huzard"
    assert grant["orcid_put_code"] == 4001
    assert funding[1]["amount"] is None and funding[1]["end_date"] is None


def test_aggregates_peer_reviews_per_organization():
    reviews = build_biosketch(fixture())["peer_reviews"]
    assert [x["organization"] for x in reviews] == [
        "Psychoneuroendocrinology",
        "Frontiers in Behavioral Neuroscience",
    ]
    assert reviews[0]["review_count"] == 2
    assert reviews[0]["last_completed"] == "2022-11-02"
    assert reviews[0]["review_type"] == "review"
    assert reviews[0]["role"] == "reviewer"
    assert reviews[0]["review_group_id"] == "issn:0306-4530"
    assert reviews[1]["review_count"] == 1
    assert reviews[1]["role"] == "editor"


def test_parses_affiliation_shaped_sections():
    bio = build_biosketch(fixture())
    assert bio["distinctions"][0]["role"] == "Young Investigator Award"
    assert bio["memberships"][0]["organization"] == "Society for Neuroscience"
    assert bio["services"][0]["department"] == "Data stewardship"
    assert bio["services"][0]["end_date"] == "2024-06"
    assert bio["qualifications"][0]["organization"] == "Université de Lausanne"
    assert bio["invited_positions"][0]["role"] == "Visiting researcher"


def test_parses_research_resources():
    resource = build_biosketch(fixture())["research_resources"][0]
    assert resource["title"] == "Longitudinal rodent behaviour imaging platform"
    assert resource["hosts"] == ["Institut de Génomique Fonctionnelle", "CNRS"]
    assert (resource["start_date"], resource["end_date"]) == ("2022-02", "2022-08")
    assert resource["source"]["id"] == "0000-0003-4820-7951"


def test_minimal_record_degrades_to_empty_lists():
    bio = build_biosketch({"orcid-identifier": {"path": "0000-0003-4820-7951"}})
    for key in (
        "employment", "education", "works", "fundings", "peer_reviews", "distinctions",
        "memberships", "services", "qualifications", "invited_positions", "research_resources",
    ):
        assert bio[key] == []
    assert bio["schema_version"] == "0.2.0"
    schema = json.loads(
        (Path(__file__).parents[1] / "schema" / "biosketch.schema.json").read_text(encoding="utf-8")
    )
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(bio)
    assert "## Funding" not in render_markdown(bio)
    assert to_jsonld(bio)["@type"] == "Person"


def test_null_activity_sections_do_not_raise():
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {
            "fundings": None,
            "peer-reviews": {"group": None},
            "memberships": {"affiliation-group": [{"summaries": None}]},
            "services": {"affiliation-group": [{"summaries": [{}]}]},
            "research-resources": {"group": [{"research-resource-summary": [{}]}]},
        },
    }
    bio = build_biosketch(record)
    assert bio["fundings"] == [] and bio["peer_reviews"] == [] and bio["memberships"] == []
    assert bio["services"][0]["organization"] is None
    assert bio["research_resources"][0]["hosts"] == []


def test_renderers_surface_new_sections():
    bio = build_biosketch(fixture())
    markdown = render_markdown(bio)
    assert "## Funding" in markdown
    assert "250000 EUR" in markdown
    assert "## Peer review" in markdown
    assert "Psychoneuroendocrinology — 2 reviews as reviewer" in markdown
    assert "## Distinctions" in markdown
    assert "## Memberships" in markdown
    assert "## Service" in markdown
    jsonld = to_jsonld(bio)
    assert jsonld["funding"][0]["@type"] == "MonetaryGrant"
    assert jsonld["funding"][0]["funder"]["name"] == "Agence Nationale de la Recherche"
    assert jsonld["funding"][0]["amount"] == {
        "@type": "MonetaryAmount", "value": "250000", "currency": "EUR",
    }
    assert jsonld["memberOf"] == [{"@type": "Organization", "name": "Society for Neuroscience"}]
    assert jsonld["award"] == ["Young Investigator Award, European Behavioural Pharmacology Society"]


import io
import urllib.error
from datetime import datetime, timedelta, timezone
from email.message import Message
from email.utils import format_datetime

import pytest
from orcid_biosketch import core
from orcid_biosketch.core import OrcidError, load_record, normalize_orcid


def test_normalizes_orcid_ids_and_urls():
    assert normalize_orcid("0000-0002-1825-0097") == "0000-0002-1825-0097"
    assert normalize_orcid("0000000218250097") == "0000-0002-1825-0097"
    assert normalize_orcid("https://orcid.org/0000-0003-4820-7951") == "0000-0003-4820-7951"


@pytest.mark.parametrize("bad", [
    "0000-0002-1825-0098",  # checksum failure, a plausible typo
    "0000-0003-4820-795",   # too short
    "0000-000X-1825-0097",  # X outside the final position
    "not-an-orcid",
    "",
])
def test_rejects_malformed_orcid_ids(bad):
    with pytest.raises(OrcidError):
        normalize_orcid(bad)


def test_loads_a_saved_record_offline(tmp_path):
    path = tmp_path / "record.json"
    path.write_text('{"orcid-identifier": {"path": "0000-0003-4820-7951"}}', encoding="utf-8")
    assert load_record(path)["orcid-identifier"]["path"] == "0000-0003-4820-7951"
    with pytest.raises(OrcidError):
        load_record(tmp_path / "missing.json")
    (tmp_path / "bad.json").write_text("{not json", encoding="utf-8")
    with pytest.raises(OrcidError):
        load_record(tmp_path / "bad.json")


def _http_error(code, retry_after=None):
    headers = Message()
    if retry_after:
        headers["Retry-After"] = retry_after
    return urllib.error.HTTPError("https://pub.orcid.org", code, "boom", headers, None)


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def test_retries_transient_failures_then_succeeds(monkeypatch):
    attempts, slept = [], []
    def urlopen(request, timeout=None):
        attempts.append(request.full_url)
        if len(attempts) < 3:
            raise _http_error(503)
        return _Response(b'{"orcid-identifier": {"path": "0000-0003-4820-7951"}}')
    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(core.time, "sleep", slept.append)
    record = core.fetch_orcid_record("0000-0003-4820-7951")
    assert record["orcid-identifier"]["path"] == "0000-0003-4820-7951"
    assert len(attempts) == 3 and slept == [1.0, 2.0]


def test_honours_retry_after_and_gives_up_with_a_clear_message(monkeypatch):
    slept = []
    monkeypatch.setattr(core.urllib.request, "urlopen",
                        lambda request, timeout=None: (_ for _ in ()).throw(_http_error(429, "5")))
    monkeypatch.setattr(core.time, "sleep", slept.append)
    with pytest.raises(OrcidError, match="HTTP 429"):
        core.fetch_orcid_record("0000-0003-4820-7951", retries=2)
    assert slept == [5.0, 5.0]


def test_honours_zero_retry_after(monkeypatch):
    slept = []
    monkeypatch.setattr(core.urllib.request, "urlopen",
                        lambda request, timeout=None: (_ for _ in ()).throw(_http_error(429, "0")))
    monkeypatch.setattr(core.time, "sleep", slept.append)
    with pytest.raises(OrcidError, match="HTTP 429"):
        core.fetch_orcid_record("0000-0003-4820-7951", retries=1)
    assert slept == [0.0]


def test_parses_http_date_retry_after():
    stamp = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=120), usegmt=True)
    delay = core._retry_after(_http_error(429, stamp))
    assert delay is not None and 115 <= delay <= 120


def test_fetches_bulk_work_details_and_can_opt_out(monkeypatch):
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {"works": {"group": [{"work-summary": [{
            "put-code": 42,
            "title": {"title": {"value": "Detailed paper"}},
        }]}]}},
    }
    calls = []

    def urlopen(request, timeout=None):
        calls.append(request.full_url)
        if request.full_url.endswith("/record"):
            return _Response(json.dumps(record).encode())
        return _Response(json.dumps({"bulk": [{"work": {
            "put-code": 42,
            "contributors": {"contributor": [{
                "credit-name": {"value": "Ada Example"},
                "contributor-orcid": {"path": None},
                "contributor-attributes": {"contributor-role": "author"},
            }]},
        }}]}).encode())

    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    detailed = core.fetch_orcid_record("0000-0003-4820-7951")
    assert build_biosketch(detailed)["works"][0]["authors"][0]["name"] == "Ada Example"
    assert calls[-1].endswith("/works/42")

    calls.clear()
    summary = core.fetch_orcid_record("0000-0003-4820-7951", include_work_details=False)
    assert build_biosketch(summary)["works"][0]["authors"] == []
    assert len(calls) == 1


def test_fetches_preferred_funding_details_and_can_opt_out(monkeypatch):
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {"fundings": {"group": [{"funding-summary": [
            {
                "display-index": "0",
                "put-code": 41,
                "title": {"title": {"value": "Publisher assertion"}},
            },
            {
                "display-index": "1",
                "put-code": 42,
                "title": {"title": {"value": "Preferred grant"}},
            },
        ]}]}},
    }
    calls = []

    def urlopen(request, timeout=None):
        calls.append(request.full_url)
        if request.full_url.endswith("/record"):
            return _Response(json.dumps(record).encode())
        return _Response(json.dumps({
            "put-code": 42,
            "amount": {"value": "57000.0", "currency-code": "EUR"},
            "url": {"value": "https://example.org/grants/42"},
        }).encode())

    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    detailed = core.fetch_orcid_record("0000-0003-4820-7951")
    funding = build_biosketch(detailed)["fundings"]
    assert len(funding) == 1
    assert funding[0]["title"] == "Preferred grant"
    assert (funding[0]["amount"], funding[0]["currency"]) == ("57000.0", "EUR")
    assert funding[0]["url"] == "https://example.org/grants/42"
    assert calls[-1].endswith("/funding/42")

    calls.clear()
    summary = core.fetch_orcid_record("0000-0003-4820-7951", include_work_details=False)
    assert build_biosketch(summary)["fundings"][0]["amount"] is None
    assert len(calls) == 1


def test_funding_detail_failure_degrades_and_continues(monkeypatch):
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {"fundings": {"group": [
            {"funding-summary": [{
                "put-code": 41,
                "title": {"title": {"value": "Unavailable detail"}},
            }]},
            {"funding-summary": [{
                "put-code": 42,
                "title": {"title": {"value": "Available detail"}},
            }]},
        ]}},
    }

    def urlopen(request, timeout=None):
        if request.full_url.endswith("/record"):
            return _Response(json.dumps(record).encode())
        if request.full_url.endswith("/funding/41"):
            raise _http_error(503)
        return _Response(json.dumps({
            "put-code": 42,
            "amount": {"value": "1000", "currency-code": "USD"},
        }).encode())

    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    fetched = core.fetch_orcid_record("0000-0003-4820-7951", retries=0)
    funding = {item["title"]: item for item in build_biosketch(fetched)["fundings"]}
    assert funding["Unavailable detail"]["amount"] is None
    assert funding["Available detail"]["amount"] == "1000"


def test_bulk_work_requests_are_batched_at_one_hundred(monkeypatch):
    groups = [{"work-summary": [{
        "put-code": code,
        "title": {"title": {"value": f"Work {code}"}},
    }]} for code in range(1, 102)]
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {"works": {"group": groups}},
    }
    calls = []

    def urlopen(request, timeout=None):
        calls.append(request.full_url)
        payload = record if request.full_url.endswith("/record") else {"bulk": []}
        return _Response(json.dumps(payload).encode())

    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    core.fetch_orcid_record("0000-0003-4820-7951")
    batches = [url.rsplit("/", 1)[-1].split(",") for url in calls if "/works/" in url]
    assert [len(batch) for batch in batches] == [100, 1]


def test_work_detail_failure_degrades_to_summaries(monkeypatch):
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {"works": {"group": [{"work-summary": [{
            "put-code": 42,
            "title": {"title": {"value": "Summary survives"}},
        }]}]}},
    }
    calls = []

    def urlopen(request, timeout=None):
        calls.append(request.full_url)
        if request.full_url.endswith("/record"):
            return _Response(json.dumps(record).encode())
        raise _http_error(503)

    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    fetched = core.fetch_orcid_record("0000-0003-4820-7951", retries=0)
    work = build_biosketch(fetched)["works"][0]
    assert work["title"] == "Summary survives"
    assert work["authors"] == []
    assert len(calls) == 2


@pytest.mark.parametrize("code,message", [(404, "no public record"), (403, "may be private")])
def test_does_not_retry_permanent_failures(monkeypatch, code, message):
    calls = []
    def urlopen(request, timeout=None):
        calls.append(request)
        raise _http_error(code)
    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    with pytest.raises(OrcidError, match=message):
        core.fetch_orcid_record("0000-0003-4820-7951")
    assert len(calls) == 1


def test_rejects_a_bad_orcid_before_any_network_call(monkeypatch):
    monkeypatch.setattr(core.urllib.request, "urlopen",
                        lambda *a, **k: pytest.fail("must validate before fetching"))
    with pytest.raises(OrcidError):
        core.fetch_orcid_record("0000-0002-1825-0098")


def test_sandbox_base_url_is_honoured(monkeypatch):
    seen = {}
    def urlopen(request, timeout=None):
        seen["url"] = request.full_url
        return _Response(b"{}")
    monkeypatch.setattr(core.urllib.request, "urlopen", urlopen)
    core.fetch_orcid_record("0000-0003-4820-7951", base_url=core.SANDBOX_API)
    assert seen["url"] == "https://pub.sandbox.orcid.org/v3.0/0000-0003-4820-7951/record"


def test_period_does_not_invent_ongoing_engagements():
    from orcid_biosketch.core import _period
    assert _period({"start_date": "2018", "end_date": None}, ongoing=False) == "2018"
    assert _period({"start_date": "2018", "end_date": None}) == "2018–present"
    assert _period({"start_date": None, "end_date": None}) == ""
    assert _period({"start_date": "2016", "end_date": "2019"}) == "2016–2019"


def test_markdown_does_not_mark_distinctions_as_ongoing():
    bio = build_biosketch(fixture())
    if bio["distinctions"]:
        rendered = render_markdown(bio)
        assert "Young Investigator Award" in rendered
        assert "–present)" not in rendered.split("## Distinctions")[1].split("## ")[0]


def test_markdown_does_not_invent_present_without_any_dates():
    bio = build_biosketch(fixture())
    bio["employment"] = [{
        "role": "Researcher", "organization": "Example University",
        "start_date": None, "end_date": None,
    }]
    employment = render_markdown(bio).split("## Employment")[1].split("## ")[0]
    assert "present" not in employment


def test_affiliations_carry_the_disambiguated_organization_id():
    record = {
        "orcid-identifier": {"path": "0000-0003-4820-7951"},
        "activities-summary": {
            "employments": {
                "affiliation-group": [{
                    "summaries": [{
                        "employment-summary": {
                            "role-title": "Researcher",
                            "organization": {
                                "name": "Example University",
                                "disambiguated-organization": {
                                    "disambiguated-organization-identifier": "https://ror.org/019whta54",
                                    "disambiguation-source": "ROR",
                                },
                            },
                        }
                    }]
                }]
            }
        },
    }
    employment = build_biosketch(record)["employment"][0]
    assert employment["organization_id"] == "https://ror.org/019whta54"
    assert employment["organization_id_source"] == "ROR"


def test_markdown_renders_qualifications_invited_positions_and_resources():
    bio = build_biosketch(fixture(), {})
    markdown = render_markdown(bio)
    for heading in ("## Qualifications", "## Invited positions", "## Research resources"):
        assert heading in markdown
    assert "Université de Lausanne" in markdown
    assert "Visiting researcher" in markdown
