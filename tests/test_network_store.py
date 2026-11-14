import copy
import io
import json
import tempfile
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest

from science_record_player.core import build_biosketch
from science_record_player.network_store import NetworkStore


ORCID_A = "0000-0002-1825-0097"
ORCID_B = "0000-0001-5109-3700"


def bio(orcid=ORCID_A, works=None):
    result = build_biosketch({"orcid-identifier": {"path": orcid}})
    result["person"]["name"] = "Test Researcher"
    result["works"] = works or []
    return result


def work(code=1, doi="10.1234/example", title="Example work"):
    return {"title": title, "type": "journal-article", "publication_date": "2020-01",
            "identifiers": {"doi": doi} if doi else {}, "orcid_put_code": code,
            "url": "", "authors": []}


@pytest.fixture
def store(tmp_path):
    return NetworkStore(tmp_path / "network.sqlite3")


def test_first_import_is_baseline_and_new_work_is_observation(store):
    store.import_biosketch(bio(works=[work()]))
    assert store.state()["events"] == []
    updated = bio(works=[work(), work(2, "10.1234/second")])
    store.import_biosketch(updated)
    event, = store.state()["events"]
    assert event["kind"] == "work-added"
    assert event["observed_at"] != updated["works"][1]["publication_date"]
    updated["works"][1]["title"] = "Corrected title"
    store.import_biosketch(updated)
    assert store.state()["events"] == [event]


def test_doi_deduplicates_people_events_and_team_bibliography(store):
    store.import_biosketch(bio())
    store.import_biosketch(bio(ORCID_B))
    store.import_biosketch(bio(works=[work(1, "https://doi.org/10.1234/EXAMPLE")]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    state = store.state()
    shared, = state["works"]
    event, = state["events"]
    assert shared["people_ids"] == [ORCID_A, ORCID_B]
    assert event["people_ids"] == shared["people_ids"]
    group = store.create_group("Team", "A local group", [ORCID_A, ORCID_B])
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        assert archive.read("bibliography.ris").decode().count("TY  - JOUR") == 1
        assert "AU  -" not in archive.read("bibliography.ris").decode()
        assert "unconfirmed" in archive.read("roster.csv").decode()
        assert f"biosketches/{ORCID_A}.md" in archive.namelist()


def test_removed_works_are_pruned_from_saved_events_and_exports(store):
    store.import_biosketch(bio())
    store.import_biosketch(bio(works=[work()]))
    key = store.state()["works"][0]["id"]
    store.save(key, True)
    group = store.create_group("Team", "", [ORCID_A])
    store.import_biosketch(bio())
    assert store.state()["works"] == []
    assert store.state()["events"] == []
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        assert "Example work" not in archive.read("bibliography.bib").decode()
        assert json.loads(archive.read(f"biosketches/{ORCID_A}.json"))["works"] == []


def test_shared_work_remains_when_only_one_researcher_removes_it(store):
    store.import_biosketch(bio(works=[work()]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    store.import_biosketch(bio())
    assert store.state()["works"][0]["people_ids"] == [ORCID_B]


def test_refresh_preserves_explicit_unfollow(store):
    store.import_biosketch(bio())
    assert store.state()["people"][0]["following"]
    store.follow(ORCID_A, False)
    store.import_biosketch(bio(works=[work()]))
    assert not store.state()["people"][0]["following"]


def test_shared_baseline_does_not_inherit_other_researchers_observation(store):
    store.import_biosketch(bio())
    store.import_biosketch(bio(works=[work()]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    state = store.state()
    assert state["works"][0]["people_ids"] == [ORCID_A, ORCID_B]
    assert state["events"][0]["people_ids"] == [ORCID_A]
    store.import_biosketch(bio())
    assert store.state()["works"][0]["people_ids"] == [ORCID_B]
    assert store.state()["events"] == []


def test_adding_doi_is_metadata_change_and_preserves_saved_state(store):
    store.import_biosketch(bio(works=[work(doi="")]))
    store.save(store.state()["works"][0]["id"], True)
    store.import_biosketch(bio(works=[work()]))
    state = store.state()
    assert state["events"] == []
    assert state["works"][0]["saved"]


def test_demo_is_explicit_idempotent_and_preserves_user_edits(store):
    store.add_demo()
    state = store.state()
    assert len(state["people"]) == 3
    assert len(state["works"]) == 3
    assert all(p["demo"] and p["orcid"] is None for p in state["people"])
    assert all(w["demo"] and w["title"].startswith("[Demo]") and not w["doi"] for w in state["works"])
    store.follow("demo-ada", False)
    group_id = state["groups"][0]["id"]
    store.update_group(group_id, "Changed", "", ["demo-ada"])
    store.add_demo()
    assert not store.state()["people"][0]["following"]
    assert store.state()["groups"][0]["name"] == "Changed"
    with zipfile.ZipFile(io.BytesIO(store.export_group(group_id))) as archive:
        assert "Fictional demonstration profile" in archive.read("biosketches/demo-ada.md").decode()
        assert "ORCID:" not in archive.read("biosketches/demo-ada.md").decode()


def test_persistence_and_independent_instances_do_not_lose_mutations(store):
    store.add_demo()
    path = store.path
    def create(index):
        NetworkStore(path).create_group(f"Group {index}", "", ["demo-ada"])
    with ThreadPoolExecutor(max_workers=6) as executor:
        list(executor.map(create, range(18)))
    assert len(NetworkStore(path).state()["groups"]) == 19
    copied = store.state()
    copied["people"].clear()
    assert len(store.state()["people"]) == 3


def test_invalid_mutations_roll_back(store):
    store.add_demo()
    initial = copy.deepcopy(store.state())
    operations = [lambda: store.follow("missing", True), lambda: store.follow("demo-ada", "yes"),
                  lambda: store.save("missing", True), lambda: store.create_group("", "", []),
                  lambda: store.create_group("Team", "", ["missing"]),
                  lambda: store.update_group("missing", "Team", "", []),
                  lambda: store.import_biosketch({"person": {"orcid": "invalid"}}),
                  lambda: store.export_group("missing")]
    for operation in operations:
        with pytest.raises(ValueError):
            operation()
        assert store.state() == initial


def test_csv_roster_neutralizes_formula_text(store):
    record = bio()
    record["person"]["name"] = "=1+1"
    store.import_biosketch(record)
    group = store.create_group("Team", "", [ORCID_A])
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        assert "'=1+1" in archive.read("roster.csv").decode()


def test_group_bibliography_uses_only_member_metadata(store):
    store.import_biosketch(bio(works=[work(title="Nonmember draft title")]))
    store.import_biosketch(bio(ORCID_B, [work(44, title="Member corrected title")]))
    group = store.create_group("Member-only group", "", [ORCID_B])
    with zipfile.ZipFile(io.BytesIO(store.export_group(group))) as archive:
        bibliography = archive.read("bibliography.bib").decode()
        assert "Member corrected title" in bibliography
        assert "Nonmember draft title" not in bibliography


def test_schemeless_doi_link_deduplicates(store):
    store.import_biosketch(bio(works=[work(doi="doi.org/10.1234/EXAMPLE")]))
    store.import_biosketch(bio(ORCID_B, [work(44)]))
    shared, = store.state()["works"]
    assert shared["people_ids"] == [ORCID_A, ORCID_B]


def test_store_leaves_no_database_handles_open():
    # Especially important on Windows, which refuses to unlink an open database.
    from pathlib import Path
    with tempfile.TemporaryDirectory() as directory:
        workspace = NetworkStore(Path(directory) / "network.sqlite3")
        workspace.add_demo()
        workspace.state()
        workspace.path.unlink()


def test_import_can_skip_following_a_new_record_but_never_changes_an_existing_preference(store):
    # "Save as contact" and "Add to group" (#56) import without following; Follow stays a separate choice.
    store.import_biosketch(bio(), follow=False)
    assert store.state()["people"][0]["following"] is False
    store.follow(ORCID_A, True)
    store.import_biosketch(bio(), follow=False)  # a refresh keeps the explicit follow
    assert store.state()["people"][0]["following"] is True
    store.import_biosketch(bio(ORCID_B))  # the default is unchanged
    assert {p["id"]: p["following"] for p in store.state()["people"]}[ORCID_B] is True
    assert len(store.state()["people"]) == 2  # re-importing an iD never duplicates the person
    with pytest.raises(ValueError):
        store.import_biosketch(bio(), follow="no")


def test_remove_demo_takes_out_the_sample_only(store):
    store.import_biosketch(bio(works=[work()]))
    store.tag_contacts([ORCID_A], ["FENS 2026"])
    store.add_contact_note(ORCID_A, "Real private note")
    store.add_demo()
    store.tag_contacts(["demo-ada"], ["FENS 2026"])
    mine = store.create_group("My group", "", [ORCID_A, "demo-sam"])
    store.select_group_work(mine, store.state()["works"][-1]["id"], True)
    assert store.remove_demo() == {"people": 3, "groups": 1, "kept_groups": []}
    state = store.state()
    assert [p["id"] for p in state["people"]] == [ORCID_A]
    assert not any(p["demo"] for p in state["people"]) and not any(w["demo"] for w in state["works"])
    assert [g["id"] for g in state["groups"]] == [mine]
    assert state["groups"][0]["member_ids"] == [ORCID_A]
    assert list(state["contacts"]) == [ORCID_A]
    assert state["contacts"][ORCID_A]["notes"][0]["text"] == "Real private note"
    assert state["contacts"][ORCID_A]["tags"] == ["FENS 2026"]
    assert store.remove_demo() == {"people": 0, "groups": 0, "kept_groups": []}  # idempotent


def test_remove_demo_keeps_a_sample_group_that_holds_the_users_own_curation(store):
    # Review of #66: a real member, their local role and a curated output in the sample group survive.
    store.add_demo()
    store.import_biosketch(bio(works=[work()]), follow=False)
    store.add_group_members("demo-open-science", [ORCID_A])
    store.set_group_member("demo-open-science", ORCID_A, "PI", "imaging", "leads WP2")
    real_work = next(w["id"] for w in store.state()["works"] if not w["demo"])
    store.select_group_work("demo-open-science", real_work, True)
    store.create_group_request("demo-open-science", "Share the protocol", "", ORCID_A, "")
    result = store.remove_demo()
    assert (result["people"], result["groups"]) == (3, 0)
    [group] = store.state()["groups"]
    assert result["kept_groups"] == [{"id": group["id"], "from": "Open Science Circle · Demo", "name": "Open Science Circle"}]
    assert group["id"] != "demo-open-science" and group["name"] == "Open Science Circle"
    assert group["description"] == ""
    assert group["member_ids"] == [ORCID_A]
    assert group["member_details"] == {ORCID_A: {"role": "PI", "expertise": "imaging", "contribution": "leads WP2"}}
    assert group["selected_work_ids"] == [real_work]
    assert [r["title"] for r in group["requests"]] == ["Share the protocol"]
    # A sample group with only a request of the user's own is kept too; an untouched one is not.
    store.add_demo()
    store.create_group_request("demo-open-science", "Book a room", "", None, "")
    assert [g["name"] for g in store.remove_demo()["kept_groups"]] == ["Open Science Circle"]
    store.add_demo()
    assert store.remove_demo() == {"people": 3, "groups": 1, "kept_groups": []}
    assert len(store.state()["groups"]) == 2


def test_remove_demo_keeps_a_sample_group_the_user_renamed_or_described(store):
    # Follow-up review of #66: the user's own text is kept even with only sample people in it.
    store.add_demo()
    store.update_group("demo-open-science", "Neuro consortium plan", "Our real plan for 2027: WP1 imaging", ["demo-ada"])
    store.set_group_member("demo-open-science", "demo-ada", "Coordinator", "", "")
    result = store.remove_demo()
    assert [g["name"] for g in result["kept_groups"]] == ["Neuro consortium plan"] and result["groups"] == 0
    [group] = store.state()["groups"]
    assert group["description"] == "Our real plan for 2027: WP1 imaging"
    assert group["member_ids"] == [] and group["member_details"] == {}
    # Only a new description counts too.
    store.add_demo()
    store.update_group("demo-open-science", "Open Science Circle · Demo", "Notes for our lab", ["demo-ada"])
    assert [g["name"] for g in store.remove_demo()["kept_groups"]] == ["Open Science Circle"]
