import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker
from orcid_biosketch.roster import (
    RosterError,
    build_export,
    build_revocation,
    candidate_contacts,
    compute_digest,
    validate_export,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures" / "roster"
SCHEMA = json.loads((ROOT / "schema" / "roster-assertion.schema.json").read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def group():
    return load("local-group.json")


def schema_errors(document):
    return [error.message for error in VALIDATOR.iter_errors(document)]


def reseal(document):
    document["digest"]["value"] = compute_digest(document)
    return document


def text(document):
    return json.dumps(document, ensure_ascii=False)


def test_schema_is_valid_draft_2020_12():
    Draft202012Validator.check_schema(SCHEMA)


def test_demo_export_is_stable_and_valid():
    document = build_export(group())
    assert document == load("demo-export.json")
    assert build_export(group()) == document
    assert schema_errors(document) == []
    assert validate_export(document) == []
    assert document["access_effect"] == {
        "grants": "none", "invitations": "none", "accounts": "none",
        "authorship": "not-implied", "credit": "not-inferred",
    }


def test_consumer_fixture_parses_without_granting_access():
    contacts = candidate_contacts(load("demo-export.json"))
    assert contacts == load("candidate-contacts.json")
    assert contacts["grants"] == contacts["invitations"] == contacts["accounts"] == []
    assert all(candidate["membership_status"] == "listed-member" for candidate in contacts["candidates"])
    assert all(candidate["requires"] == ["authenticated-local-account", "project-controller-approved-invitation"]
               for candidate in contacts["candidates"])
    assert all(claim["confirmed_by_import"] is False for claim in contacts["credit_claims"])


def test_build_does_not_modify_the_local_group():
    source = group()
    before = copy.deepcopy(source)
    build_export(source, fields=["orcid", "display_name", "local_role"], include_project_references=True)
    assert source == before


def test_default_export_shares_only_orcid_ids():
    document = build_export(group())
    assert document["redaction"]["member_fields"] == ["orcid"]
    assert all(member["display_name"] is None and member["local_role"] is None for member in document["members"])
    assert "Synthetic Researcher" not in text(document)


def test_assertions_keep_public_curated_and_membership_facts_distinct():
    member = build_export(group())["members"][0]
    assert member["person_assertion"]["basis"] == "public-orcid-record"
    assert member["person_assertion"]["evidence"]["source_record_version"] == "2026-08-30T10:00:00Z"
    assert member["orcid"]["status"] == "claimed"
    assert member["orcid"]["assertion"]["basis"] == "owner-curated"
    assert member["membership"]["status"] == "listed-member"
    assert member["membership"]["assertion"]["basis"] == "owner-curated"


def test_private_member_never_leaves_the_workspace():
    for kwargs in ({}, {"members": ["m-a", "m-c"]}, {"fields": ["orcid", "display_name", "local_role"]}):
        document = build_export(group(), **kwargs)
        serialized = text(document)
        assert "m-c" not in serialized
        assert "0000-0002-1694-233X" not in serialized
        assert "Synthetic Researcher C" not in serialized
        assert "Advisor" not in serialized
        assert document["redaction"]["private_members"] == "omitted"


def test_checksum_invalid_orcid_is_refused():
    source = group()
    source["members"][1]["orcid"] = "0000-0001-5109-3701"
    with pytest.raises(RosterError, match="checksum"):
        build_export(source)

    document = build_export(group())
    document["members"][1]["orcid"]["id"] = "0000-0001-5109-3701"
    document["members"][1]["orcid"]["uri"] = "https://orcid.org/0000-0001-5109-3701"
    assert any("checksum" in problem for problem in validate_export(reseal(document)))


def test_forged_orcid_verification_is_refused():
    source = group()
    source["members"][0]["orcid_status"] = "oauth-verified"
    with pytest.raises(RosterError, match="cannot assert ORCID verification"):
        build_export(source)

    document = build_export(group())
    document["members"][0]["orcid"]["status"] = "oauth-verified"
    assert schema_errors(document) == []
    assert any("OAuth-verified" in problem for problem in validate_export(reseal(document)))

    document["origin"] = "external-platform"
    assert any("external-verified evidence" in problem for problem in validate_export(reseal(document)))


def test_orcid_uri_must_match_the_id():
    document = build_export(group())
    document["members"][0]["orcid"]["uri"] = "https://orcid.org/0000-0001-5109-3700"
    assert any("URI does not match" in problem for problem in validate_export(reseal(document)))


def test_unverified_roster_entry_stays_a_listed_member():
    source = group()
    source["members"][1]["membership_status"] = "verified-invitation-accepted"
    with pytest.raises(RosterError, match="cannot assert accepted invitations"):
        build_export(source)

    for status in ("verified-invitation-accepted", "active-member-per-source"):
        document = build_export(group())
        document["members"][1]["membership"]["status"] = status
        assert any("can only list members" in problem for problem in validate_export(reseal(document)))

    document = build_export(group())
    document["members"][1]["membership"]["assertion"]["basis"] = "external-verified"
    assert any("external-verified" in problem for problem in validate_export(reseal(document)))


def test_external_platform_membership_needs_evidence():
    document = build_export(group())
    document["origin"] = "external-platform"
    membership = document["members"][1]["membership"]
    membership["status"] = "active-member-per-source"
    assert any("needs external-verified evidence" in problem for problem in validate_export(reseal(document)))
    membership["assertion"]["basis"] = "external-verified"
    membership["assertion"]["evidence"]["reference"] = "urn:example:membership-check:1"
    assert validate_export(reseal(document)) == []


def test_duplicate_researcher_is_refused():
    source = group()
    source["members"][1]["orcid"] = "0000-0002-1825-0097"
    with pytest.raises(RosterError, match="share ORCID iD"):
        build_export(source)

    document = build_export(group())
    document["members"][1]["orcid"] = copy.deepcopy(document["members"][0]["orcid"])
    assert any("duplicate researcher" in problem for problem in validate_export(reseal(document)))

    document = build_export(group())
    document["members"][1]["member_key"] = "m-a"
    assert any("duplicate member key" in problem for problem in validate_export(reseal(document)))


def test_revoked_consent_yields_only_a_content_free_notice():
    source = group()
    source["consent"].update(status="revoked", revoked_at="2026-10-02T09:00:00Z")
    with pytest.raises(RosterError, match="revoked"):
        build_export(source)

    notice = build_revocation(source)
    assert schema_errors(notice) == []
    assert validate_export(notice) == []
    assert notice["members"] == notice["outputs"] == notice["contributions"] == []
    assert notice["generated_at"] == "2026-10-02T09:00:00Z"
    with pytest.raises(RosterError, match="discard"):
        candidate_contacts(notice)

    stale = build_export(group())
    stale["consent"].update(status="revoked", revoked_at="2026-10-02T09:00:00Z")
    assert any("still carries members" in problem for problem in validate_export(reseal(stale)))


def test_export_requires_creator_opt_in():
    source = group()
    del source["consent"]
    with pytest.raises(RosterError, match="opt-in"):
        build_export(source)

    source = group()
    source["consent"]["granted_by"] = "m-b"
    with pytest.raises(RosterError, match="group creator"):
        build_export(source)


def test_unsupported_source_rights_are_excluded():
    document = build_export(group())
    assert [output["output_key"] for output in document["outputs"]] == ["o-1", "o-2"]
    assert document["redaction"]["excluded_outputs"] == ["not-selected", "unsupported-source-rights"]
    assert "roster-demo-4" not in text(document)

    document["outputs"][1]["source_rights"] = "third-party-private"
    assert schema_errors(document)
    assert any("unsupported source rights" in problem for problem in validate_export(reseal(document)))


def test_selective_pack_export():
    document = build_export(group(), members=["m-a"], outputs=["o-1"], fields=["orcid", "display_name"])
    assert schema_errors(document) == []
    assert validate_export(document) == []
    assert [member["member_key"] for member in document["members"]] == ["m-a"]
    assert document["members"][0]["display_name"] == "Synthetic Researcher A"
    assert document["members"][0]["local_role"] is None
    assert [output["output_key"] for output in document["outputs"]] == ["o-1"]
    assert [(credit["member_key"], credit["credit_role"]) for credit in document["contributions"]] == [
        ("m-a", "conceptualization")
    ]
    assert "m-b" not in text(document)

    with pytest.raises(RosterError, match="Unknown members"):
        build_export(group(), members=["m-z"])
    with pytest.raises(RosterError, match="Unknown member fields"):
        build_export(group(), fields=["email"])


def test_redacted_fields_cannot_reappear():
    document = build_export(group())
    document["members"][0]["display_name"] = "Synthetic Researcher A"
    assert any("not chosen for export" in problem for problem in validate_export(reseal(document)))


def test_credit_is_never_inferred_from_membership_or_outputs():
    source = group()
    source["contributions"] = []
    document = build_export(source)
    assert document["members"] and document["outputs"]
    assert document["contributions"] == []

    for change, message in (
        ({"status": "inferred"}, "only source-declared or curator-confirmed"),
        ({"status": "auto-confirmed"}, "only source-declared or curator-confirmed"),
        ({"credit_role": "author"}, "not a CRediT role"),
        ({"reference": None}, "needs a reference"),
    ):
        source = group()
        source["contributions"][1].update(change)
        with pytest.raises(RosterError, match=message):
            build_export(source)

    document = build_export(group())
    document["contributions"][0]["status"] = "inferred"
    assert schema_errors(document)
    assert any("never inferred" in problem for problem in validate_export(reseal(document)))


def test_contributions_must_point_inside_the_export():
    document = build_export(group())
    document["contributions"][0]["member_key"] = "m-c"
    assert any("member who is not in the export" in problem for problem in validate_export(reseal(document)))


def test_project_references_are_opt_in_and_never_leak_private_urls():
    assert build_export(group())["project_references"] == []

    document = build_export(group(), include_project_references=True)
    assert validate_export(document) == []
    reference = document["project_references"][0]
    assert reference["status"] == "proposed"
    assert reference["url"] is None
    assert "example.org" not in text(document)

    reference["url"] = "https://example.org/private/synthetic-project-1"
    assert any("without sharing approval" in problem for problem in validate_export(reseal(document)))


def test_digest_detects_tampering():
    document = build_export(group())
    document["members"][0]["member_key"] = "m-x"
    assert "digest does not match the document" in validate_export(document)
    with pytest.raises(RosterError, match="digest"):
        candidate_contacts(document)


def test_access_effect_cannot_be_changed():
    document = build_export(group())
    document["access_effect"]["grants"] = "project-read"
    assert schema_errors(document)
    assert any("grants nothing" in problem for problem in validate_export(reseal(document)))


def test_public_outputs_never_read_rosters():
    package = ROOT / "src" / "orcid_biosketch"
    # The local network pilot curates group rosters in its private workspace; it
    # must still never load the roster assertion contract.
    private_workspace = {"roster.py", "network.py", "network_store.py"}
    for module in package.glob("*.py"):
        text = module.read_text(encoding="utf-8")
        if module.name not in private_workspace:
            assert "roster" not in text, module.name
        elif module.name != "roster.py":
            assert "from .roster" not in text and "orcid_biosketch.roster" not in text, module.name
    for path in (ROOT / "generated").iterdir():
        assert "roster-assertion" not in path.read_text(encoding="utf-8", errors="ignore"), path.name
    assert "roster" not in (ROOT / ".github" / "workflows" / "sync.yml").read_text(encoding="utf-8")
