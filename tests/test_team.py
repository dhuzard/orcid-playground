import json
from pathlib import Path

import pytest

from orcid_biosketch.team import group_health, render_health, team_biosketch

SAMPLE = json.loads((Path(__file__).parents[1] / "generated" / "biosketch.json").read_text(encoding="utf-8"))


def member(orcid, name, *, works=None, employment=None):
    return {"person": {"orcid": orcid, "name": name}, "works": works or [], "employment": employment or [],
            "provenance": {"generated_at": "2026-10-30"}}


SPARSE = member("0000-0000-0000-0001", "Sparse | Person")
SHARED = {"title": "Joint paper", "publication_date": "2024", "identifiers": {"doi": "10.1/joint"}, "type": "journal-article"}


def test_health_ranks_members_and_shared_issues_from_their_record_checks():
    health = group_health([SAMPLE, SPARSE])
    assert [m["name"] for m in health["members"]] == ["Sparse | Person", SAMPLE["person"]["name"]]
    assert health["score"] == round(sum(m["percentage"] for m in health["members"]) / 2)
    assert health["grade"] in {"A+", "A", "B", "C", "D", "F"}
    counts = [len(i["members"]) for i in health["issues"]]
    assert counts == sorted(counts, reverse=True) and all(i["fix"] for i in health["issues"])


def test_health_report_names_every_member_and_says_membership_is_unconfirmed():
    report = render_health(group_health([SAMPLE, SPARSE]), "Lab")
    assert "# Record health: Lab" in report and "not confirmed" in report
    assert SAMPLE["person"]["orcid"] in report and "0000-0000-0000-0001" in report


def test_empty_group_health_is_well_formed():
    assert group_health([]) == {"score": 0, "grade": "F", "members": [], "issues": [],
                                "basis": group_health([])["basis"]}


@pytest.mark.parametrize("template", ["erc", "horizon", "nih"])
def test_team_biosketch_nests_each_member_and_lists_only_doi_backed_joint_outputs(template):
    a = member("0000-0000-0000-0002", "Ada", works=[SHARED], employment=[{"role": "PI", "organization": "Lab U"}])
    b = member("0000-0000-0000-0003", "Ben", works=[{**SHARED, "identifiers": {"doi": "https://doi.org/10.1/JOINT"}}])
    doc = team_biosketch([a, b, SPARSE], template, "Consortium")
    assert doc.startswith("# Team biosketch: Consortium") and "not confirmed" in doc
    assert "| Ada | https://orcid.org/0000-0000-0000-0002 | PI, Lab U |" in doc
    assert "| Sparse / Person |" in doc and "Not stated in the record" in doc
    assert "https://doi.org/10.1/joint. Asserted by Ada, Ben." in doc
    # Each member keeps its own provenance line, nested under the team document.
    assert doc.count("Generated from the ORCID record") == 3 and "\n# " not in doc.split("## Team", 1)[1]


def test_team_biosketch_without_shared_dois_says_so_and_rejects_unknown_templates():
    assert "None found" in team_biosketch([SAMPLE, SPARSE], "nih", "Lab")
    with pytest.raises(ValueError, match="Unknown template"):
        team_biosketch([SAMPLE], "../../etc/passwd", "Lab")


def test_every_record_check_has_a_plain_language_label():
    from orcid_biosketch import lint
    from orcid_biosketch.team import CHECK_LABELS
    assert {name for name, _, _ in lint.CHECKS} <= set(CHECK_LABELS)
