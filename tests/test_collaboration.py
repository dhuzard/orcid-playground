from orcid_biosketch.collaboration import collaboration_graph, doi_key, group_bibliography


def bio(orcid, name, *works):
    return {"person": {"orcid": orcid, "name": name},
            "works": [{"title": t, "publication_date": d, "identifiers": {"doi": doi} if doi else {}, "orcid_put_code": i}
                      for i, (t, d, doi) in enumerate(works)]}


ADA = bio("0000-0000-0000-0001", "Ada", ("Shared paper", "2024-01", "10.1/ABC"), ("Solo", "2023", None))
BEN = bio("0000-0000-0000-0002", "Ben", ("Shared paper", "2024", "https://doi.org/10.1/abc"), ("Other", "2022", "10.1/xyz"))
CAL = bio("0000-0000-0000-0003", "Cal", ("Same title, no DOI", "2024", None))


def test_doi_key_normalises_resolvers_and_case():
    assert doi_key({"identifiers": {"DOI": " doi:10.1/ABC "}}) == "10.1/abc"
    assert doi_key({"identifiers": {"doi": "https://dx.doi.org/10.1/Abc"}}) == "10.1/abc"
    assert doi_key({"identifiers": None}) == "" and doi_key("not a work") == ""


def test_edges_require_the_same_doi_on_both_records_and_cite_it():
    graph = collaboration_graph([ADA, BEN, CAL])
    assert graph["edges"] == [{"source": ADA["person"]["orcid"], "target": BEN["person"]["orcid"],
                               "outputs": [{"doi": "10.1/abc", "title": "Shared paper", "year": "2024"}]}]
    linked = {n["name"]: n["linked"] for n in graph["nodes"]}
    assert linked == {"Ada": True, "Ben": True, "Cal": False}


def test_no_links_are_inferred_from_titles_or_duplicate_members():
    graph = collaboration_graph([CAL, bio("0000-0000-0000-0004", "Dee", ("Same title, no DOI", "2024", None)), CAL])
    assert graph["edges"] == [] and graph["shared_outputs"] == [] and len(graph["nodes"]) == 2


def test_bibliography_merges_by_doi_and_records_who_asserts_each_work():
    works = group_bibliography([ADA, BEN, CAL])
    shared = next(w for w in works if w["title"] == "Shared paper")
    assert shared["asserted_by"] == [ADA["person"]["orcid"], BEN["person"]["orcid"]]
    assert len(works) == 4 and works[0]["publication_date"] >= works[-1]["publication_date"]
